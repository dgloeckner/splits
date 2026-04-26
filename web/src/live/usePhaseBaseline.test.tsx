import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePhaseBaseline } from './usePhaseBaseline'
import { LiveSessionContext } from './LiveSessionContext'
import { initialLiveState, type LiveState } from './reducer'
import type { ReactNode } from 'react'

function wrap(state: LiveState) {
  return ({ children }: { children: ReactNode }) => (
    <LiveSessionContext.Provider value={state}>{children}</LiveSessionContext.Provider>
  )
}

const baseStroke = {
  session_id: 's1',
  stroke: 1,
  time_sec: 0,
  distance_m: 0,
  spm: 0,
  power_w: 0,
  cal_per_hr: 0,
  level: 0,
  dps: 0,
  stroke_cycle_sec: 0,
  pace_sec_per_500m: 0,
  energy_joules: 0,
}

describe('usePhaseBaseline', () => {
  it('zero during warmup', () => {
    const state: LiveState = {
      ...initialLiveState,
      phase: 'warmup',
      phaseAnchor: { distanceM: 0, timeSec: 0 },
      stroke: { ...baseStroke, distance_m: 5, time_sec: 10 },
    }
    const { result } = renderHook(() => usePhaseBaseline(), { wrapper: wrap(state) })
    expect(result.current.displayDistanceM).toBe(0)
    expect(result.current.displayTimeSec).toBe(0)
    expect(result.current.frozen).toBe(false)
  })

  it('hard reset at warmup→work', () => {
    const state: LiveState = {
      ...initialLiveState,
      phase: 'work',
      phaseAnchor: { distanceM: 5, timeSec: 30 },
      stroke: { ...baseStroke, distance_m: 100, time_sec: 60 },
    }
    const { result } = renderHook(() => usePhaseBaseline(), { wrapper: wrap(state) })
    expect(result.current.displayDistanceM).toBe(95)
    expect(result.current.displayTimeSec).toBe(30)
  })

  it('frozen=true during cooldown phase', () => {
    const state: LiveState = {
      ...initialLiveState,
      phase: 'cooldown',
      phaseAnchor: { distanceM: 500, timeSec: 120 },
      stroke: { ...baseStroke, distance_m: 510, time_sec: 130 },
    }
    const { result } = renderHook(() => usePhaseBaseline(), { wrapper: wrap(state) })
    expect(result.current.frozen).toBe(true)
  })

  it('null phase passes through raw stroke', () => {
    const state: LiveState = {
      ...initialLiveState,
      phase: null,
      stroke: { ...baseStroke, distance_m: 42, time_sec: 99 },
    }
    const { result } = renderHook(() => usePhaseBaseline(), { wrapper: wrap(state) })
    expect(result.current.displayDistanceM).toBe(42)
    expect(result.current.displayTimeSec).toBe(99)
  })
})
