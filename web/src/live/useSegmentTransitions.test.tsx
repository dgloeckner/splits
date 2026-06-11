import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LiveSessionContext } from './LiveSessionContext'
import { initialLiveState, type LiveState } from './reducer'
import { useSegmentTransitions } from './useSegmentTransitions'

const originalFetch = global.fetch
const originalVibrate = (navigator as any).vibrate

afterEach(() => {
  global.fetch = originalFetch
  ;(navigator as any).vibrate = originalVibrate
})

function mockWorkout() {
  global.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('/api/v1/workouts/W1')) {
      return new Response(JSON.stringify({
        id: 'W1',
        mode: 'intervals',
        params: { reps: 2, length: { unit: 'm', value: 500 }, rest_sec: 60 },
        warmup_sec: 120,
        cooldown_sec: 0,
        created_at: '2026-04-24T00:00:00Z',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('nope', { status: 404 })
  }) as typeof fetch
}

function wrap(state: LiveState): (p: { children: ReactNode }) => ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => (
    <QueryClientProvider client={qc}>
      <LiveSessionContext.Provider value={state}>{children}</LiveSessionContext.Provider>
    </QueryClientProvider>
  )
}

function stateFor(distanceM: number, timeSec: number): LiveState {
  return {
    ...initialLiveState,
    session: { session_id: 'S1', started_at: '', rower_id: 'R', rower_name: 'A', initial_level: 3, workout_id: 'W1' },
    stroke: { session_id: 'S1', stroke: 1, time_sec: timeSec, distance_m: distanceM, spm: 20, power_w: 100, cal_per_hr: 500, level: 3, dps: 8, stroke_cycle_sec: 3, pace_sec_per_500m: 150, energy_joules: 300, work_distance_m: distanceM, work_time_sec: timeSec, phase_distance_m: distanceM, phase_time_sec: timeSec },
  }
}

describe('useSegmentTransitions', () => {
  it('does not vibrate on initial mount', async () => {
    const spy = vi.fn(() => true)
    ;(navigator as any).vibrate = spy
    mockWorkout()

    const { rerender } = renderHook(() => useSegmentTransitions(), { wrapper: wrap(stateFor(0, 0)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(spy).not.toHaveBeenCalled()
    rerender()
    expect(spy).not.toHaveBeenCalled()
  })

  it('vibrates when segment index rises', async () => {
    const spy = vi.fn(() => true)
    ;(navigator as any).vibrate = spy
    mockWorkout()

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let state = stateFor(0, 0)
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <LiveSessionContext.Provider value={state}>{children}</LiveSessionContext.Provider>
      </QueryClientProvider>
    )
    const { rerender } = renderHook(() => useSegmentTransitions(), { wrapper: Wrapper })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    // Advance state past warmup into work (warmup 120s, so time=120 transitions to work)
    state = stateFor(0, 120)
    rerender()
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(spy).toHaveBeenCalledWith([80, 40, 80])
  })
})
