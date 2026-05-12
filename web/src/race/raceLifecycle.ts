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
  | { type: 'stroke'; t: number; dist: number; userDistance: number; total?: number }
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
      if (state.phase !== 'Ceremony' || state.bereitTapAtMs == null) return state
      const elapsed = event.nowMs - state.bereitTapAtMs
      const step = ceremonyStepFor(elapsed)
      if (step === 'POST_GO') {
        return {
          ...state,
          phase: 'Live',
          ceremonyStep: null,
          liveKind: 'NormalStart',
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
          // at the pending GO moment.
          return {
            ...state,
            phase: 'Live',
            ceremonyStep: null,
            liveKind: 'Falschstart',
            falschstart: true,
            session_start: event.t,
          }
        }
        // Stroke during GO! is a normal first stroke. Defer transition
        // to the post-GO tick; record session_start though.
        return state
      }
      if (state.phase === 'Live') {
        if (state.session_start == null) {
          state = { ...state, session_start: event.t }
        }
        if (event.total != null && event.userDistance >= event.total) {
          const totalMeters = state._config.totalMeters ?? event.total
          const latched = computeRaceResultLatch({
            cross: { t: event.t, dist: event.dist },
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
      if (state.phase === 'Live' || state.phase === 'Finished') {
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
