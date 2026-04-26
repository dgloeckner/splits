import { useRef } from 'react'
import { useLiveSession } from './LiveSessionContext'

export type PhaseBaseline = {
  phase: 'warmup' | 'work' | 'rest' | 'cooldown' | null
  displayDistanceM: number
  displayTimeSec: number
  frozen: boolean
}

export function usePhaseBaseline(): PhaseBaseline {
  const state = useLiveSession()
  const frozenWork = useRef<{ d: number; t: number }>({ d: 0, t: 0 })
  const workAnchor = useRef<{ d: number; t: number } | null>(null)

  const phase = state.phase
  const stroke = state.stroke
  const anchor = state.phaseAnchor

  if (phase === 'work' && anchor) {
    workAnchor.current = { d: anchor.distanceM, t: anchor.timeSec }
  }

  if (phase === 'work' && stroke && workAnchor.current) {
    const d = Math.max(0, stroke.distance_m - workAnchor.current.d)
    const t = Math.max(0, stroke.time_sec - workAnchor.current.t)
    frozenWork.current = { d, t }
    return { phase, displayDistanceM: d, displayTimeSec: t, frozen: false }
  }
  if (phase === 'warmup') {
    return { phase, displayDistanceM: 0, displayTimeSec: 0, frozen: false }
  }
  if (phase === 'rest' || phase === 'cooldown') {
    return {
      phase,
      displayDistanceM: frozenWork.current.d,
      displayTimeSec: frozenWork.current.t,
      frozen: true,
    }
  }
  return {
    phase,
    displayDistanceM: stroke?.distance_m ?? 0,
    displayTimeSec: stroke?.time_sec ?? 0,
    frozen: false,
  }
}
