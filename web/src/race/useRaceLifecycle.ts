import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  initialRaceLifecycle,
  raceLifecycle,
  type RaceLifecycleEvent,
  type RaceLifecycleState,
} from './raceLifecycle'

/**
 * React hook wrapper around the pure `raceLifecycle` reducer.
 *
 * The 1500-ms ceremony ticks are driven from `requestAnimationFrame` so
 * we never need to recreate timers when the component re-renders. The
 * caller is responsible for dispatching `bereitTap`, `stroke`,
 * `sessionEnd`, `abort` and `confirm` events.
 */
export function useRaceLifecycle() {
  const [state, dispatch] = useReducer(raceLifecycle, undefined, initialRaceLifecycle)
  const stateRef = useRef<RaceLifecycleState>(state)
  stateRef.current = state

  useEffect(() => {
    if (state.phase !== 'Ceremony') return
    let raf = 0
    const loop = () => {
      dispatch({ type: 'tick', nowMs: performance.now() })
      if (stateRef.current.phase === 'Ceremony') raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [state.phase])

  const send = useCallback((e: RaceLifecycleEvent) => dispatch(e), [])

  return { state, send }
}
