import { useEffect, useRef } from 'react'
import type { LiveState } from '../live/reducer'
import { BereitScreen } from './BereitScreen'
import { RaceLiveView } from './RaceLiveView'
import { RaceStartSequence } from './RaceStartSequence'
import { FalschstartToast } from './FalschstartToast'
import { FinishOverlay } from './FinishOverlay'
import { RacePostScreen } from './RacePostScreen'
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
}

export function RaceFlow({ liveState, totalMeters, opponentsLabel, onRetry, onShowDetail }: Props) {
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
    })
  }, [liveState.stroke, state.phase, totalMeters, send])

  // Forward session-end (caller's reducer sets `summary` when the
  // session closes).
  useEffect(() => {
    if (liveState.summary && (state.phase === 'Live' || state.phase === 'Finished')) {
      send({ type: 'sessionEnd' })
    }
  }, [liveState.summary, state.phase, send])

  if (state.phase === 'Confirmed' || state.phase === 'Bereit') {
    return (
      <BereitScreen
        distanceMeters={totalMeters}
        opponentsLabel={opponentsLabel}
        onTap={() => send({ type: 'bereitTap', t: performance.now() })}
      />
    )
  }

  const liveMounted =
    (state.phase === 'Ceremony' && state.ceremonyStep === 'GO') ||
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
        />
      )}
      {state.phase === 'Ceremony' && (
        <RaceStartSequence enabled reducedMotion={reducedMotion} />
      )}
      <FalschstartToast visible={state.falschstart && state.phase === 'Live'} />
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
}: {
  liveState: LiveState
  totalMeters: number
  lifecycle: RaceLifecycleState
  send: (e: RaceLifecycleEvent) => void
  onRetry?: () => void
  onShowDetail?: () => void
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

  return (
    <>
      <RaceLiveView liveState={liveState} totalMeters={totalMeters} />
      {lifecycle.phase === 'Finished' && lifecycle.latchedResult && (
        <FinishOverlay result={lifecycle.latchedResult} />
      )}
    </>
  )
}
