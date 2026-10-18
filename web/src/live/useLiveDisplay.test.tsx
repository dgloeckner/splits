import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useDeadReckonedTime,
  useDeadReckonedDistance,
  useSmoothed,
  useCountUp,
  useIsLivePaused,
  usePhasedDistance,
  usePhasedTime,
} from './useLiveDisplay'
import { liveReducer, initialLiveState, type LiveState } from './reducer'
import type { LiveEvent, StrokePayload } from './events'
import { smoothingConfig } from './smoothing'

/** Override window.matchMedia so prefers-reduced-motion returns `matches`. */
function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({
      matches: matches && q.includes('reduce'),
      media: q,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true
      },
    }),
  })
}

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
      work_distance_m: 0,
      work_time_sec: 0,
      phase_distance_m: 0,
      phase_time_sec: 0,
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
    const s: LiveState = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { time_sec: 10 }),
    })
    // Push Date.now beyond the pause threshold.
    vi.advanceTimersByTime(smoothingConfig.deadReckoning.pauseThresholdMs + 100)
    const { result } = renderHook(() => useDeadReckonedTime(s))
    expect(result.current.paused).toBe(true)
    // Frozen at the last authoritative value (10 s → "0:10").
    expect(result.current.text).toBe('0:10')
  })
})

describe('useDeadReckonedDistance', () => {
  it('reports raw distance at the instant the stroke arrives (sinceFrame=0)', () => {
    const s = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { time_sec: 2, distance_m: 8 }),
    })
    const { result } = renderHook(() => useDeadReckonedDistance(s))
    expect(result.current.text).toBe('8')
  })

  it('extrapolates using EMA-smoothed pace, not the two-stroke Δm/Δs delta', () => {
    // Cold-start: smoothed seeds with the first stroke's raw values, so
    // EMA pace = 132 → speed = 500/132 ≈ 3.788 m/s.
    let s = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { time_sec: 2, distance_m: 8, pace_sec_per_500m: 132 }),
    })
    s = liveReducer(s, {
      type: 'event',
      event: stroke(2, { time_sec: 4, distance_m: 16, pace_sec_per_500m: 132 }),
    })
    // Advance wall-clock 800 ms past the latest stroke receipt.
    vi.advanceTimersByTime(800)
    const { result } = renderHook(() => useDeadReckonedDistance(s))
    // 16 + 0.8 * (500/132) ≈ 19.03 → fmtInt truncates to 19.
    expect(result.current.text).toBe('19')
  })

  it('falls back to dps / stroke_cycle_sec when EMA pace is unavailable', () => {
    let s = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { time_sec: 2, distance_m: 8, dps: 8, stroke_cycle_sec: 2 }),
    })
    // Force the smoothed slot to null to simulate pre-seed state.
    s = { ...s, smoothed: null }
    vi.advanceTimersByTime(250)
    const { result } = renderHook(() => useDeadReckonedDistance(s))
    // speed = 8/2 = 4 m/s; 8 + 0.25 * 4 = 9.
    expect(result.current.text).toBe('9')
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

describe('useIsLivePaused', () => {
  afterEach(() => {
    // Restore default matchMedia stub (always returns matches: false).
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string): MediaQueryList =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    })
  })

  it('returns true when serverPaused is set, even with a fresh lastStrokeReceivedAtMs', () => {
    const state: LiveState = {
      ...initialLiveState,
      lastStrokeReceivedAtMs: Date.now(),
      stroke: stroke(1, { time_sec: 2, distance_m: 8 }).data as StrokePayload,
      serverPaused: true,
    }
    const { result } = renderHook(() => useIsLivePaused(state))
    expect(result.current).toBe(true)
  })

  it('detects a pause under prefers-reduced-motion via the interval fallback', () => {
    mockReducedMotion(true)
    const state: LiveState = {
      ...initialLiveState,
      lastStrokeReceivedAtMs: Date.now(),
      stroke: stroke(1, { time_sec: 2, distance_m: 8 }).data as StrokePayload,
    }
    const { result } = renderHook(() => useIsLivePaused(state))
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(smoothingConfig.deadReckoning.pauseThresholdMs + 100)
    })
    expect(result.current).toBe(true)
  })
})

describe('usePhasedDistance', () => {
  it('returns placeholder when no stroke', () => {
    const { result } = renderHook(() => usePhasedDistance(initialLiveState))
    expect(result.current.text).toBe('—')
  })

  it('returns phase_distance_m from the stamped stroke field (no extrapolation at t=0)', () => {
    const s = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { phase_distance_m: 50, distance_m: 450, time_sec: 10 }),
      nowMs: Date.now(),
    })
    const { result } = renderHook(() => usePhasedDistance(s))
    // At t=0 sinceFrame the result is exactly phase_distance_m (fmtInt truncates)
    expect(result.current.text).toBe('50')
  })

  it('adds dead-reckoning delta on top of phase_distance_m as time passes', () => {
    const s = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, {
        phase_distance_m: 50,
        distance_m: 450,
        time_sec: 10,
        pace_sec_per_500m: 100,
      }),
      nowMs: Date.now(),
    })
    vi.advanceTimersByTime(1000)
    const { result } = renderHook(() => usePhasedDistance(s))
    // speed = 500/100 = 5 m/s; 1s elapsed → ≥ 55
    const parsed = parseInt(result.current.text, 10)
    expect(parsed).toBeGreaterThanOrEqual(55)
  })

  it('shows 0 when phase_distance_m is 0 (warmup/no work yet)', () => {
    const s = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { phase_distance_m: 0, work_distance_m: 0, phase: 'warmup' }),
      nowMs: Date.now(),
    })
    const { result } = renderHook(() => usePhasedDistance(s))
    expect(result.current.text).toBe('0')
  })

  it('freezes extrapolation after pause threshold elapses', () => {
    const s = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { phase_distance_m: 100, distance_m: 500, time_sec: 20, pace_sec_per_500m: 100 }),
      nowMs: Date.now(),
    })
    vi.advanceTimersByTime(smoothingConfig.deadReckoning.pauseThresholdMs + 100)
    const { result } = renderHook(() => usePhasedDistance(s))
    // Paused → frozen at stamped phase_distance_m (delta = max(0, distance_m - distance_m) = 0)
    expect(result.current.text).toBe('100')
    expect(result.current.paused).toBe(true)
  })
})

describe('usePhasedTime', () => {
  it('returns placeholder when no stroke', () => {
    const { result } = renderHook(() => usePhasedTime(initialLiveState))
    expect(result.current.text).toBe('—')
  })

  it('returns phase_time_sec formatted as mm:ss', () => {
    const s = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { phase_time_sec: 75, time_sec: 200, distance_m: 800 }),
      nowMs: Date.now(),
    })
    const { result } = renderHook(() => usePhasedTime(s))
    expect(result.current.text).toBe('1:15')
  })

  it('extrapolates phase_time_sec upward between strokes', () => {
    const s = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { phase_time_sec: 30, time_sec: 100, distance_m: 400 }),
      nowMs: Date.now(),
    })
    vi.advanceTimersByTime(3000)
    const { result } = renderHook(() => usePhasedTime(s))
    // 30 + 3 = 33s displayed
    const [minStr, secStr] = result.current.text.split(':')
    const displayed = parseInt(minStr, 10) * 60 + parseInt(secStr, 10)
    expect(displayed).toBeGreaterThanOrEqual(33)
  })

  it('freezes after pause threshold elapses', () => {
    const s = liveReducer(initialLiveState, {
      type: 'event',
      event: stroke(1, { phase_time_sec: 60, time_sec: 200 }),
      nowMs: Date.now(),
    })
    vi.advanceTimersByTime(smoothingConfig.deadReckoning.pauseThresholdMs + 100)
    const { result } = renderHook(() => usePhasedTime(s))
    // Paused → frozen at phase_time_sec (delta = max(0, time_sec - time_sec) = 0)
    expect(result.current.text).toBe('1:00')
    expect(result.current.paused).toBe(true)
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
