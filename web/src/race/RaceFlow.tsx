import { useEffect, useRef } from 'react'
import type { LiveState } from '../live/reducer'
import { BereitScreen } from './BereitScreen'
import { RaceLiveView } from './RaceLiveView'
import { RaceStartSequence } from './RaceStartSequence'
import { FalschstartToast } from './FalschstartToast'
import { FinishOverlay } from './FinishOverlay'
import { RacePostScreen } from './RacePostScreen'
import { AbortControl } from './AbortControl'
import { useRaceLifecycle } from './useRaceLifecycle'
import { useReducedMotion } from './reducedMotion'
import { useRaceData } from './useRaceData'
import type { RaceLifecycleEvent, RaceLifecycleState } from './raceLifecycle'

/**
 * Top-level race-mode flow. Owns the lifecycle reducer and routes
 * between `BereitScreen`, the start ceremony, the live view, the
 * `FinishOverlay` (0014-06) and the post screen. The live subscription
 * (live data + `RaceLiveView`) is gated on the reducer having reached
 * Ceremony(GO!) or later — see PRD §Modules.
 */
type Props = {
  liveState: LiveState
  totalMeters: number
  opponentsLabel: string
  onRetry?: () => void
  onShowDetail?: () => void
  /**
   * Optional session-termination hook invoked on confirmed abort. The
   * caller should run the existing X-abort flow (enqueueEndSession +
   * WorkoutOverlay.abort() + navigate home); the backend's
   * `AbortBeforeGoal` path then persists `summary.race = null`. If
   * omitted, the reducer still transitions to `Aborted` and the race
   * surface unmounts.
   */
  onAbort?: () => void
  /**
   * 0019-03: explicit Fertig affordance on the FinishOverlay. The
   * caller should fire `session_end` via the existing
   * `endSessionQueue` path (same end-point as the manual abort flow,
   * different trigger) and navigate the rower home. If omitted, the
   * Fertig button still renders but the idle-timeout `session_end`
   * remains the only exit path.
   */
  onFinish?: () => void
}

export function RaceFlow({ liveState, totalMeters, opponentsLabel, onRetry, onShowDetail, onAbort, onFinish }: Props) {
  const { state, send } = useRaceLifecycle({ totalMeters })
  const reducedMotion = useReducedMotion()

  // Auto-confirm on first mount: arrival on this flow means opponent
  // picker confirm landed us here, so we are post-Confirmed and should
  // present Bereit.
  const confirmedOnce = useRef(false)
  useEffect(() => {
    if (!confirmedOnce.current) {
      confirmedOnce.current = true
      send({ type: 'confirm' })
    }
  }, [send])

  // Forward strokes into the reducer. The stroke time is the live
  // reducer's `time_sec` (caller's clock). `userDistance` drives the
  // finish-cross transition.
  const lastStrokeKey = useRef<string | null>(null)
  useEffect(() => {
    if (state.phase !== 'Ceremony' && state.phase !== 'Live' && state.phase !== 'Finished') return
    const stroke = liveState.stroke
    if (!stroke) return
    const key = `${stroke.time_sec}:${stroke.distance_m}`
    if (key === lastStrokeKey.current) return
    lastStrokeKey.current = key
    send({
      type: 'stroke',
      t: stroke.time_sec,
      dist: stroke.distance_m,
      userDistance: stroke.distance_m,
      total: totalMeters,
      // Snapshot the instantaneous cross-stroke fields onto the latch
      // so StatBar/Canvas freezes lock to the same stroke as the
      // FinishOverlay even under batched SSE delivery (0019-02).
      watts: stroke.power_w,
      spm: stroke.spm,
      split: stroke.pace_sec_per_500m,
      // Wall-clock at dispatch — only used by the Ceremony→Live
      // (Falschstart) transition to latch the toast's display
      // anchor. See raceLifecycle.ts §falschstartShownAtMs.
      nowMs: performance.now(),
    })
  }, [liveState.stroke, state.phase, totalMeters, send])

  // Forward session-end (caller's reducer sets `summary` when the
  // session closes).
  useEffect(() => {
    if (liveState.summary && (state.phase === 'Live' || state.phase === 'Finished')) {
      send({ type: 'sessionEnd' })
    }
  }, [liveState.summary, state.phase, send])

  const handleConfirmAbort = () => {
    send({ type: 'abort' })
    if (onAbort) onAbort()
  }

  // Aborted terminal: unmount the race surface entirely. Caller's
  // `onAbort` is expected to have triggered the existing session-end
  // path (enqueueEndSession → backend AbortBeforeGoal → summary.race=null).
  if (state.phase === 'Aborted') {
    return null
  }

  if (state.phase === 'Confirmed' || state.phase === 'Bereit') {
    return (
      <>
        <BereitScreen
          distanceMeters={totalMeters}
          opponentsLabel={opponentsLabel}
          onTap={() => send({ type: 'bereitTap', t: performance.now() })}
        />
        {state.phase === 'Bereit' && (
          <AbortControl onConfirmAbort={handleConfirmAbort} />
        )}
      </>
    )
  }

  // ADR-0013: the canvas + opponent fetch mount at Ceremony(ATTENTION),
  // not at Ceremony(GO!). The visible boat stays parked at distance 0
  // until GO! fires (see `RaceLiveStage` for the clamp). The live-stroke
  // subscription is unaffected — strokes are still routed through the
  // reducer, which discards pre-GO meters from race-distance/race-time.
  const liveMounted =
    state.phase === 'Ceremony' ||
    state.phase === 'Live' ||
    state.phase === 'Finished' ||
    state.phase === 'Post'

  return (
    <>
      {liveMounted && (
        <RaceLiveStage
          liveState={liveState}
          totalMeters={totalMeters}
          lifecycle={state}
          send={send}
          onRetry={onRetry}
          onShowDetail={onShowDetail}
          onFinish={onFinish}
        />
      )}
      {state.phase === 'Ceremony' && (
        <RaceStartSequence enabled reducedMotion={reducedMotion} />
      )}
      {/*
       * Toast lifetime is anchored to `state.falschstartShownAtMs`,
       * not `state.phase`: under fast-fixture replay the reducer can
       * transition Falschstart → Live → Finished in the same render
       * frame, so a phase-gated visibility check would flash-and-
       * vanish faster than any human (or Playwright poll) can see.
       * See .scratch/race-finish-cleanup/issues/10-...md.
       */}
      <FalschstartToast triggeredAtMs={state.falschstartShownAtMs} />
      {(state.phase === 'Ceremony' || state.phase === 'Live') && (
        <AbortControl onConfirmAbort={handleConfirmAbort} />
      )}
    </>
  )
}

/**
 * Inner stage that owns the opponent fetch (`useRaceData`). Mounted
 * only once the reducer has reached Ceremony(GO!) so the live-data
 * subscription stays gated. Keeps the canvas mounted across the
 * Finished → Post transition: the `FinishOverlay` slides over the
 * still-running canvas while the rower paddles out.
 */
function RaceLiveStage({
  liveState,
  totalMeters,
  lifecycle,
  send,
  onRetry,
  onShowDetail,
  onFinish,
}: {
  liveState: LiveState
  totalMeters: number
  lifecycle: RaceLifecycleState
  send: (e: RaceLifecycleEvent) => void
  onRetry?: () => void
  onShowDetail?: () => void
  onFinish?: () => void
}) {
  const opps = useRaceData({
    workoutId: liveState.session?.workout_id ?? null,
    rowerId: liveState.session?.rower_id ?? null,
  })

  // Push opponents into the reducer so the finish-cross latch can
  // compute signed gaps from immutable distance curves.
  useEffect(() => {
    send({
      type: 'setConfig',
      config: {
        opponents: {
          ghost: opps.ghost ? { tSec: opps.ghost.tSec, distM: opps.ghost.distM } : undefined,
          pb: opps.pb ? { tSec: opps.pb.tSec, distM: opps.pb.distM } : undefined,
        },
      },
    })
  }, [opps.ghost, opps.pb, send])

  // Post screen: derive user series from latched + live state where
  // possible. We keep the canvas mounted *behind* the overlay during
  // Finished, then swap to the full RacePostScreen when Post arrives.
  if (lifecycle.phase === 'Post') {
    const latched = lifecycle.latchedResult
    const userTotalSec = latched?.finalTimeS ?? liveState.stroke?.time_sec ?? 0
    return (
      <RacePostScreen
        totalMeters={totalMeters}
        userTotalSec={userTotalSec}
        userTSec={[]}
        userSplit={[]}
        ghost={opps.ghost}
        pb={opps.pb}
        vsGhostSec={latched?.gaps.ghost ?? null}
        vsPbSec={latched?.gaps.pb ?? null}
        onRetry={onRetry ?? (() => {})}
        onShowDetail={onShowDetail ?? (() => {})}
      />
    )
  }

  // Visual gate (ADR-0013): until GO! fires, the rower's boat must stay
  // parked at distance 0 on the canvas even if a Falschstart stroke has
  // already opened the session. The reducer already excludes pre-GO
  // meters from race-distance/race-time; this is the visual mirror.
  const stroke = liveState.stroke
  const inCeremony = lifecycle.phase === 'Ceremony'
  const preGoFalschstart =
    lifecycle.phase === 'Live' &&
    lifecycle.falschstart &&
    lifecycle.race_t0 != null &&
    stroke != null &&
    stroke.time_sec * 1000 < lifecycle.race_t0
  const clampVisualToZero = inCeremony || preGoFalschstart
  const visualLiveState: LiveState =
    clampVisualToZero && stroke
      ? { ...liveState, stroke: { ...stroke, distance_m: 0 } }
      : clampVisualToZero
        ? { ...liveState, stroke: null }
        : liveState

  return (
    <>
      <RaceLiveView
        liveState={visualLiveState}
        totalMeters={totalMeters}
        latchedResult={lifecycle.latchedResult}
      />
      {lifecycle.phase === 'Finished' && lifecycle.latchedResult && (
        <FinishOverlay result={lifecycle.latchedResult} onFinish={onFinish} />
      )}
    </>
  )
}
