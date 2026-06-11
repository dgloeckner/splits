import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  initialRaceLifecycle,
  raceLifecycle,
  type RaceLifecycleConfig,
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
export function useRaceLifecycle(config?: RaceLifecycleConfig) {
  const [state, dispatch] = useReducer(raceLifecycle, config, initialRaceLifecycle)
  const stateRef = useRef<RaceLifecycleState>(state)
  stateRef.current = state

  useEffect(() => {
    const needsTick =
      state.phase === 'Ceremony' ||
      (state.phase === 'Live' && state.falschstart && !state.goFired)
    if (!needsTick) return
    let raf = 0
    const loop = () => {
      dispatch({ type: 'tick', nowMs: performance.now() })
      const s = stateRef.current
      const keepTicking =
        s.phase === 'Ceremony' || (s.phase === 'Live' && s.falschstart && !s.goFired)
      if (keepTicking) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    }
  }, [state.phase, state.falschstart, state.goFired])

  const send = useCallback((e: RaceLifecycleEvent) => dispatch(e), [])

  return { state, send }
}
