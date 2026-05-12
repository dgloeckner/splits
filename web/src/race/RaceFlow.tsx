import { useEffect, useRef } from 'react'
import type { LiveState } from '../live/reducer'
import { BereitScreen } from './BereitScreen'
import { RaceLiveView } from './RaceLiveView'
import { RaceStartSequence } from './RaceStartSequence'
import { FalschstartToast } from './FalschstartToast'
import { useRaceLifecycle } from './useRaceLifecycle'
import { useReducedMotion } from './reducedMotion'

/**
 * Top-level race-mode flow. Owns the lifecycle reducer and routes
 * between `BereitScreen`, the start ceremony, and the live view. The
 * live subscription (live data + `RaceLiveView`) is gated on the
 * reducer having reached Ceremony(GO!) or Live — see PRD §Modules.
 */
type Props = {
  liveState: LiveState
  totalMeters: number
  opponentsLabel: string
}

export function RaceFlow({ liveState, totalMeters, opponentsLabel }: Props) {
  const { state, send } = useRaceLifecycle()
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
    if (state.phase !== 'Ceremony' && state.phase !== 'Live') return
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
      {liveMounted && <RaceLiveView liveState={liveState} totalMeters={totalMeters} />}
      {state.phase === 'Ceremony' && (
        <RaceStartSequence enabled reducedMotion={reducedMotion} />
      )}
      <FalschstartToast visible={state.falschstart && state.phase === 'Live'} />
    </>
  )
}
