import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useDeadReckonedTime,
  useDeadReckonedDistance,
  useSmoothed,
  useCountUp,
} from './useLiveDisplay'
import { liveReducer, initialLiveState, type LiveState } from './reducer'
import type { LiveEvent, StrokePayload } from './events'
import { smoothingConfig } from './smoothing'

function stroke(id: number, payload: Partial<StrokePayload>): LiveEvent {
  return {
    kind: 'stroke',
    id,
    data: {
      session_id: 'S1',
      stroke: id,
      time_sec: id * 2,
      distance_m: id * 8,
      spm: 27,
      power_w: 200,
      cal_per_hr: 800,
      level: 3,
      dps: 8,
      stroke_cycle_sec: 2.2,
      pace_sec_per_500m: 132,
      energy_joules: 500,
      ...payload,
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-20T10:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useDeadReckonedTime', () => {
  it('returns em-dash before any stroke', () => {
    const { result } = renderHook(() => useDeadReckonedTime(initialLiveState))
    expect(result.current.text).toBe('—')
    expect(result.current.paused).toBe(false)
  })

  it('freezes + flags paused once the pause threshold elapses', () => {
    let s: LiveState = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { time_sec: 10 }),
    })
    // Push Date.now beyond the pause threshold.
    vi.advanceTimersByTime(smoothingConfig.deadReckoning.pauseThresholdMs + 100)
    const { result } = renderHook(() => useDeadReckonedTime(s))
    expect(result.current.paused).toBe(true)
    // Frozen at the last authoritative value (10 s → "0:10.0").
    expect(result.current.text).toBe('0:10.0')
  })
})

describe('useDeadReckonedDistance', () => {
  it('falls back to raw distance when only one stroke seen (speed=0)', () => {
    const s = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { time_sec: 2, distance_m: 8 }),
    })
    const { result } = renderHook(() => useDeadReckonedDistance(s))
    // Only one stroke → no speed → text reflects raw distance formatted.
    expect(result.current.text).toBe('8')
  })
})

describe('useSmoothed', () => {
  it('returns em-dash while no smoothed state is present', () => {
    const { result } = renderHook(() => useSmoothed(initialLiveState))
    expect(result.current).toEqual({
      watts: '—',
      split: '—',
      spm: '—',
      dps: '—',
      spi: '—',
    })
  })

  it('applies display-level hysteresis to watts across renders', () => {
    const s1: LiveState = {
      ...initialLiveState,
      smoothed: { power: 200, paceSecPer500m: 130, spm: 30, dps: 8, spi: 6.7 },
    }
    const { result, rerender } = renderHook(({ st }: { st: LiveState }) => useSmoothed(st), {
      initialProps: { st: s1 },
    })
    expect(result.current.watts).toBe('200')

    // A 2W jump is below the 3W hysteresis → display sticks at 200.
    const s2: LiveState = { ...s1, smoothed: { ...s1.smoothed!, power: 202 } }
    rerender({ st: s2 })
    expect(result.current.watts).toBe('200')

    // A 5W jump crosses threshold → display updates.
    const s3: LiveState = { ...s1, smoothed: { ...s1.smoothed!, power: 207 } }
    rerender({ st: s3 })
    expect(result.current.watts).toBe('207')
  })
})

describe('useCountUp', () => {
  it('returns null when target is null', () => {
    const { result } = renderHook(() => useCountUp(null, 250))
    expect(result.current).toBe(null)
  })

  it('immediately reports the seed on first render', () => {
    const { result } = renderHook(() => useCountUp(100, 250))
    expect(result.current).toBe(100)
  })

  it('tweens toward a new target over the duration', async () => {
    const { result, rerender } = renderHook(({ v }: { v: number }) => useCountUp(v, 200), {
      initialProps: { v: 100 },
    })
    rerender({ v: 200 })
    // Advance halfway through the tween.
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current!).toBeGreaterThan(100)
    expect(result.current!).toBeLessThan(200)
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBeCloseTo(200, 1)
  })
})
