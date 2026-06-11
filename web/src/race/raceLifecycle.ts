/**
 * Pure race-lifecycle reducer. No React.
 *
 * Encodes the deliberate Bereit am Catch flow:
 *   Confirmed -confirm-> Bereit
 *   Bereit -bereitTap-> Ceremony(ATTENTION)
 *     -1500ms-> Ceremony(SET) -1500ms-> Ceremony(GO!) -1500ms-> Live(NormalStart)
 *   Ceremony(ATTENTION|SET) -stroke-> Live(Falschstart)
 *     session_start = stroke t, race_t0 = pending GO! moment
 *   Live -userDistance>=total-> Finished (latchedResult left null; 0014-06)
 *   Live|Finished -sessionEnd-> Post
 *   non-terminal -abort-> Aborted
 *
 * See `.scratch/race-mode-cleanup/PRD.md` and CONTEXT.md (race_t0,
 * Falschstart, Bereit) for the architectural decisions.
 */

import { computeRaceResultLatch, type LatchOpponentCurve, type RaceResultLatch } from './raceResultLatch'

export type CeremonyStep = 'ATTENTION' | 'SET' | 'GO'
export type LiveKind = 'NormalStart' | 'Falschstart'
export type RacePhase =
  | 'Confirmed'
  | 'Bereit'
  | 'Ceremony'
  | 'Live'
  | 'Finished'
  | 'Post'
  | 'Aborted'

export type RaceLifecycleConfig = {
  totalMeters?: number | null
  opponents?: { ghost?: LatchOpponentCurve; pb?: LatchOpponentCurve }
}

export type RaceLifecycleState = {
  phase: RacePhase
  ceremonyStep: CeremonyStep | null
  liveKind: LiveKind | null
  /** Wall-clock-ish ms when Bereit was tapped (input from caller). */
  bereitTapAtMs: number | null
  /** ms at GO! (pending or fired); used as race-time origin. */
  race_t0: number | null
  /** session_start in stroke-time seconds (caller's clock). */
  session_start: number | null
  falschstart: boolean
  /**
   * Wall-clock ms (caller's `performance.now()`) at the moment the
   * reducer transitioned Ceremony(ATTENTION|SET) → Live(Falschstart).
   * Null until the transition fires; one-shot — never overwritten by
   * subsequent strokes or phase changes.
   *
   * Owned by the FalschstartToast container in RaceFlow.tsx: the
   * toast renders while `Date.now()` (or `performance.now()`) is
   * within FALSCHSTART_TOAST_MS of this latch, regardless of how
   * fast the reducer subsequently transitions through Live →
   * Finished → Post. Without this latch, under fast-fixture replay
   * the entire race can complete inside one render frame and the
   * toast flashes-and-vanishes before Playwright (or a human) can
   * observe it. See `.scratch/race-finish-cleanup/issues/10-...md`.
   */
  falschstartShownAtMs: number | null
  /** True once the GO! moment has passed (same clock domain as race_t0). */
  goFired: boolean
  /** Last pre-GO stroke position (Falschstart only); F2 subtracts this from race distance/time. */
  goAnchor: { t: number; dist: number } | null
  /** Latched finish-cross result (0014-06); null until the user crosses. */
  latchedResult: RaceResultLatch | null
  /** Captured config + last stroke for latch derivation. Internal. */
  _config: RaceLifecycleConfig
  _prevStroke: { t: number; dist: number } | null
}

export type RaceLifecycleEvent =
  | { type: 'confirm' }
  | { type: 'bereitTap'; t: number }
  | { type: 'tick'; nowMs: number }
  | {
      type: 'stroke'
      t: number
      dist: number
      userDistance: number
      total?: number
      /**
       * Optional instantaneous values from the cross stroke. When the
       * user crosses the finish line, these are snapshotted onto
       * `latchedResult.crossSnapshot` so that render-time observers
       * (StatBar, RaceCanvas) freeze on the exact cross stroke even if
       * React batches subsequent SSE strokes into the same render
       * (0019-02 AC3/AC4).
       */
      watts?: number
      spm?: number
      split?: number
      /**
       * Wall-clock `performance.now()` at the moment this stroke
       * event was dispatched. Used to latch `falschstartShownAtMs`
       * for the Ceremony(ATTENTION|SET) → Live(Falschstart) toast
       * lifetime guard. Optional — pre-existing call sites that
       * omit it (older tests) get the legacy "no latch" behaviour
       * and the toast simply won't auto-dismiss on time.
       */
      nowMs?: number
    }
  | { type: 'setConfig'; config: RaceLifecycleConfig }
  | { type: 'sessionEnd' }
  | { type: 'abort' }

export const CEREMONY_STEP_MS = 1500

export function initialRaceLifecycle(config?: RaceLifecycleConfig): RaceLifecycleState {
  return {
    phase: 'Confirmed',
    ceremonyStep: null,
    liveKind: null,
    bereitTapAtMs: null,
    race_t0: null,
    session_start: null,
    falschstart: false,
    falschstartShownAtMs: null,
    goFired: false,
    goAnchor: null,
    latchedResult: null,
    _config: config ?? {},
    _prevStroke: null,
  }
}

function ceremonyStepFor(elapsedMs: number): CeremonyStep | 'POST_GO' {
  if (elapsedMs < CEREMONY_STEP_MS) return 'ATTENTION'
  if (elapsedMs < 2 * CEREMONY_STEP_MS) return 'SET'
  if (elapsedMs < 3 * CEREMONY_STEP_MS) return 'GO'
  return 'POST_GO'
}

export function raceLifecycle(
  state: RaceLifecycleState,
  event: RaceLifecycleEvent,
): RaceLifecycleState {
  // Terminal: no transitions out.
  if (state.phase === 'Aborted' || state.phase === 'Post') return state

  switch (event.type) {
    case 'confirm':
      if (state.phase === 'Confirmed') return { ...state, phase: 'Bereit' }
      return state

    case 'setConfig':
      // Allowed pre-Finished; once the latch is sealed we don't accept
      // late opponent updates (consistency).
      if (state.phase === 'Finished') return state
      return { ...state, _config: { ...state._config, ...event.config } }

    case 'bereitTap':
      if (state.phase === 'Bereit') {
        return {
          ...state,
          phase: 'Ceremony',
          ceremonyStep: 'ATTENTION',
          bereitTapAtMs: event.t,
          // pending GO moment is bereitTap + 2 step intervals
          race_t0: event.t + 2 * CEREMONY_STEP_MS,
        }
      }
      return state

    case 'tick': {
      // Falschstart GO detection: the pre-GO Live phase ticks through here.
      // useRaceLifecycle drives ticks during Ceremony; the Falschstart branch
      // below is reached when the caller also ticks during Live(Falschstart)
      // (useRaceLifecycle is responsible for extending the tick loop).
      if (
        state.phase === 'Live' &&
        state.falschstart &&
        !state.goFired &&
        state.race_t0 != null &&
        event.nowMs >= state.race_t0
      ) {
        return { ...state, goFired: true, goAnchor: state._prevStroke ?? null }
      }

      if (state.phase !== 'Ceremony' || state.bereitTapAtMs == null) return state
      const elapsed = event.nowMs - state.bereitTapAtMs
      const step = ceremonyStepFor(elapsed)
      if (step === 'POST_GO') {
        return {
          ...state,
          phase: 'Live',
          ceremonyStep: null,
          liveKind: 'NormalStart',
          goFired: true,
          goAnchor: null,
          // race_t0 was set at bereitTap to bereitTap + 2*STEP (the GO moment)
        }
      }
      if (step !== state.ceremonyStep) {
        return { ...state, ceremonyStep: step }
      }
      return state
    }

    case 'stroke': {
      if (state.phase === 'Ceremony') {
        if (state.ceremonyStep === 'ATTENTION' || state.ceremonyStep === 'SET') {
          // Falschstart — session opens at this stroke but race_t0 stays
          // at the pending GO moment. `falschstartShownAtMs` is latched
          // once here so the toast can stay visible for its full
          // duration even if the next transition (Live → Finished)
          // fires within the same render frame under fast-fixture
          // replay. The check is one-shot: subsequent strokes hit the
          // Live branch and leave this field alone.
          return {
            ...state,
            phase: 'Live',
            ceremonyStep: null,
            liveKind: 'Falschstart',
            falschstart: true,
            falschstartShownAtMs: event.nowMs ?? null,
            session_start: event.t,
            _prevStroke: { t: event.t, dist: event.dist },
          }
        }
        // Stroke during GO! is the race-start signal: transition to
        // Live(NormalStart) immediately and fall through to the Live
        // path so this stroke's distance is recorded (and an immediate
        // finish-cross can latch in the same step). race_t0 stays at
        // the pending GO! moment set at bereitTap.
        state = {
          ...state,
          phase: 'Live',
          ceremonyStep: null,
          liveKind: 'NormalStart',
        }
      }
      if (state.phase === 'Live') {
        if (state.session_start == null) {
          state = { ...state, session_start: event.t }
        }
        const raceDistOffset = state.goAnchor?.dist ?? 0
        const raceTimeOffset = state.goAnchor?.t ?? 0
        const raceDist = event.userDistance - raceDistOffset
        if (event.total != null && raceDist >= event.total) {
          const totalMeters = state._config.totalMeters ?? event.total
          const latched = computeRaceResultLatch({
            cross: {
              t: event.t - raceTimeOffset,
              dist: event.dist - raceDistOffset,
              watts: event.watts,
              spm: event.spm,
              split: event.split,
            },
            prev: state._prevStroke,
            totalMeters,
            opponents: state._config.opponents ?? {},
          })
          return {
            ...state,
            phase: 'Finished',
            latchedResult: latched,
            _prevStroke: { t: event.t, dist: event.dist },
          }
        }
        return { ...state, _prevStroke: { t: event.t, dist: event.dist } }
      }
      // Finished: keep latched result frozen; ignore subsequent strokes
      // for latch purposes (still update _prevStroke for completeness).
      if (state.phase === 'Finished') {
        return { ...state, _prevStroke: { t: event.t, dist: event.dist } }
      }
      return state
    }

    case 'sessionEnd': {
      // Pre-finish session_end (idle-timeout, abort) collapses straight
      // to Post — there's no latched result to keep the FinishOverlay
      // up. Once we've crossed the line, however, the race-surface
      // freeze must persist until the rower taps Fertig (0019-02 /
      // 0019-03): the backend's session_end fires within milliseconds
      // of the fixture EOF at fast pacing, but the StatBar + Canvas
      // freeze and the FinishOverlay are explicitly designed to stay
      // visible across the paddle-down. The Fertig handler (parent's
      // `onFinish`) is the only path that advances Finished → Post.
      //
      // Safeguard for fast-fixture replay: if a stroke at or past the
      // finish line has already been recorded (`_prevStroke.dist >=
      // totalMeters`) but the reducer is somehow still in Live —
      // typically because the cross-stroke `userDistance >= total`
      // path needed an `event.total` that the dispatcher hadn't
      // supplied yet — late-latch the result here so the rower lands
      // on the FinishOverlay instead of the deprecated Post screen.
      if (state.phase === 'Live') {
        const total = state._config.totalMeters ?? null
        const prev = state._prevStroke
        if (total != null && prev != null && prev.dist >= total) {
          const latched = computeRaceResultLatch({
            cross: { t: prev.t, dist: prev.dist },
            prev: null,
            totalMeters: total,
            opponents: state._config.opponents ?? {},
          })
          return { ...state, phase: 'Finished', latchedResult: latched }
        }
        return { ...state, phase: 'Post' }
      }
      return state
    }

    case 'abort': {
      // Finished is treated as terminal for abort (result already latched).
      if (
        state.phase === 'Bereit' ||
        state.phase === 'Ceremony' ||
        state.phase === 'Live' ||
        state.phase === 'Confirmed'
      ) {
        return { ...state, phase: 'Aborted' }
      }
      return state
    }
  }
}
