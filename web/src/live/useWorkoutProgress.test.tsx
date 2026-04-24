import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LiveSessionContext } from './LiveSessionContext'
import { initialLiveState, type LiveState } from './reducer'
import { useWorkoutProgress } from './useWorkoutProgress'

const originalFetch = global.fetch
type R = { body: string | null; status: number }
function mockRoutes(routes: Record<string, R | ((init?: RequestInit) => R)>) {
  global.fetch = vi.fn(async (url, init) => {
    const raw = String(url); const key = raw.split('?')[0]
    const v = routes[raw] ?? routes[key]
    if (!v) return new Response('nope', { status: 404 })
    const r = typeof v === 'function' ? v(init) : v
    return new Response(r.body, { status: r.status, headers: r.body ? { 'content-type': 'application/json' } : undefined })
  }) as typeof fetch
}
afterEach(() => { global.fetch = originalFetch })

function wrap(state: LiveState): (p: { children: ReactNode }) => ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => (
    <QueryClientProvider client={qc}>
      <LiveSessionContext.Provider value={state}>
        {children}
      </LiveSessionContext.Provider>
    </QueryClientProvider>
  )
}

describe('useWorkoutProgress', () => {
  it('returns null workoutId when no session', () => {
    mockRoutes({})
    const { result } = renderHook(() => useWorkoutProgress(), {
      wrapper: wrap({ ...initialLiveState, session: null }),
    })
    expect(result.current.workoutId).toBeNull()
    expect(result.current.segments).toEqual([])
    expect(result.current.active).toBeNull()
  })

  it('fetches workout + derives segments + active', async () => {
    mockRoutes({
      '/api/v1/workouts/W1': {
        body: JSON.stringify({
          id: 'W1',
          mode: 'intervals',
          params: { reps: 2, length: { unit: 'm', value: 500 }, rest_sec: 60 },
          intensity: 'moderat',
          warmup_sec: 120,
          cooldown_sec: 0,
          created_at: '2026-04-24T00:00:00Z',
        }),
        status: 200,
      },
    })
    const { result } = renderHook(() => useWorkoutProgress(), {
      wrapper: wrap({
        ...initialLiveState,
        session: { session_id: 'S1', started_at: '', rower_id: 'R1', rower_name: 'A', initial_level: 3, workout_id: 'W1' },
        stroke: { session_id: 'S1', stroke: 1, time_sec: 60, distance_m: 0, spm: 20, power_w: 100, cal_per_hr: 500, level: 3, dps: 8, stroke_cycle_sec: 3, pace_sec_per_500m: 150, energy_joules: 300 },
      }),
    })
    await waitFor(() => expect(result.current.segments.length).toBeGreaterThan(0))
    expect(result.current.workoutId).toBe('W1')
    expect(result.current.active?.segment.kind).toBe('warmup')
  })

  it('no stroke → active is null even with segments', async () => {
    mockRoutes({
      '/api/v1/workouts/W1': {
        body: JSON.stringify({
          id: 'W1', mode: 'distance', params: { meters: 2000 },
          warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-24T00:00:00Z',
        }),
        status: 200,
      },
    })
    const { result } = renderHook(() => useWorkoutProgress(), {
      wrapper: wrap({
        ...initialLiveState,
        session: { session_id: 'S1', started_at: '', rower_id: 'R1', rower_name: 'A', initial_level: 3, workout_id: 'W1' },
        stroke: null,
      }),
    })
    await waitFor(() => expect(result.current.segments.length).toBe(1))
    expect(result.current.active).toBeNull()
  })
})
