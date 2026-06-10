import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useBootReconcile } from './useBootReconcile'
import { LiveSessionContext } from './LiveSessionContext'
import { initialLiveState, type LiveState, type LiveAction } from './reducer'
import { ApiError } from '../api/error'
import type { SessionRow, SessionSummary } from '../api/client'

function wrap(state: LiveState, dispatch: (a: LiveAction) => void) {
  return ({ children }: { children: ReactNode }) => (
    <LiveSessionContext.Provider value={{ ...state, dispatch }}>
      {children}
    </LiveSessionContext.Provider>
  )
}

const baseSession = {
  session_id: 'S1',
  started_at: '2026-05-17T10:00:00Z',
  rower_id: 'R1',
  rower_name: 'Daniel',
  initial_level: 3,
  workout_id: 'W1',
}

const cachedActive: LiveState = {
  ...initialLiveState,
  session: baseSession,
  summary: null,
}

const sessionRow = (overrides: Partial<SessionRow> = {}): SessionRow => ({
  id: 'S1',
  rower_id: 'R1',
  started_at: '2026-05-17T10:00:00Z',
  initial_level: 3,
  workout_id: 'W1',
  ...overrides,
})

describe('useBootReconcile', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('drops cached active state when BE reports ended_at IS NOT NULL', async () => {
    const dispatch = vi.fn()
    const getSession = vi.fn().mockResolvedValue(
      sessionRow({ ended_at: '2026-05-17T10:30:00Z' }),
    )
    renderHook(() => useBootReconcile({ getSession }), {
      wrapper: wrap(cachedActive, dispatch),
    })
    await waitFor(() => expect(getSession).toHaveBeenCalledWith('S1'))
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: 'reset', summary: null }),
    )
  })

  // AC2: hook seeds `summary` from the BE row so downstream consumers
  // (Historie, RacePostScreen) don't have to refetch the just-finalised
  // session right after boot.
  it('seeds summary from BE row when ended_at IS NOT NULL (AC2)', async () => {
    const persisted: SessionSummary = {
      total_distance_m: 2000,
      total_time_sec: 480,
      total_strokes: 200,
      avg_power_w: 180,
      peak_power_w: 320,
      avg_spm: 24,
      avg_dps: 8,
      avg_spi: 7.5,
      avg_pace_sec_per_500m: 120,
      session_calories: 95,
    }
    // Drive a real reducer so we can observe the resulting liveState.
    const { useReducer } = await import('react')
    const { liveReducer } = await import('./reducer')
    const getSession = vi.fn().mockResolvedValue(
      sessionRow({ ended_at: '2026-05-17T10:30:00Z', summary: persisted }),
    )
    let observed: LiveState | null = null
    function Inner() {
      const [state, dispatch] = useReducer(liveReducer, cachedActive)
      observed = state
      return (
        <LiveSessionContext.Provider value={{ ...state, dispatch }}>
          <Probe />
        </LiveSessionContext.Provider>
      )
    }
    function Probe() {
      useBootReconcile({ getSession })
      return null
    }
    render(<Inner />)
    await waitFor(() => expect(observed!.session).toBeNull())
    expect(observed!.summary).toEqual({
      total_distance_m: 2000,
      total_time_sec: 480,
      total_strokes: 200,
      avg_power_w: 180,
      peak_power_w: 320,
      avg_spm: 24,
      avg_dps: 8,
      avg_pace_sec_per_500m: 120,
      session_calories: 95,
    })
  })

  it('preserves cache when BE reports ended_at IS NULL for the matching session', async () => {
    // AC3: not only must dispatch be skipped, but the LiveState
    // reference must be unchanged after the hook runs — proving no
    // dispatch happened and the §Stale-open recovery flow can read
    // the same cached state on its next render.
    const { useReducer } = await import('react')
    const { liveReducer } = await import('./reducer')
    const getSession = vi.fn().mockResolvedValue(sessionRow({ ended_at: undefined }))

    let dispatchSpy: ((a: LiveAction) => void) | null = null
    let observed: LiveState | null = null
    function Harness() {
      const [state, dispatch] = useReducer(liveReducer, cachedActive)
      observed = state
      dispatchSpy = dispatch
      return (
        <LiveSessionContext.Provider value={{ ...state, dispatch }}>
          <Probe />
        </LiveSessionContext.Provider>
      )
    }
    function Probe() {
      useBootReconcile({ getSession })
      return null
    }
    render(<Harness />)
    const before = observed!
    const sessionBefore = before.session
    const summaryBefore = before.summary

    await waitFor(() => expect(getSession).toHaveBeenCalledWith('S1'))
    await act(async () => {
      await Promise.resolve()
    })

    // No dispatch fired at all (object identity preserved through the
    // useReducer is the strongest possible signal).
    expect(observed).toBe(before)
    expect(observed!.session).toBe(sessionBefore)
    expect(observed!.summary).toBe(summaryBefore)
    // sanity: dispatch is real and was wired up; we just didn't call it.
    expect(typeof dispatchSpy).toBe('function')
  })

  it('drops cache silently when BE returns 404', async () => {
    const dispatch = vi.fn()
    const getSession = vi.fn().mockRejectedValue(new ApiError(404, '404 Not Found'))
    renderHook(() => useBootReconcile({ getSession }), {
      wrapper: wrap(cachedActive, dispatch),
    })
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: 'reset' }),
    )
  })

  it('runs exactly once at boot — not on subsequent context updates', async () => {
    const dispatch = vi.fn()
    const getSession = vi.fn().mockResolvedValue(sessionRow({ ended_at: undefined }))
    const { rerender } = renderHook(() => useBootReconcile({ getSession }), {
      wrapper: wrap(cachedActive, dispatch),
    })
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1))
    rerender()
    rerender()
    rerender()
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when there is no cached session at boot', async () => {
    const dispatch = vi.fn()
    const getSession = vi.fn()
    renderHook(() => useBootReconcile({ getSession }), {
      wrapper: wrap(initialLiveState, dispatch),
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(getSession).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('integration: BottomNav unlocks + no recovery card after reconcile drops a finalised cached session', async () => {
    // Render a probe that consumes the same context and reports the
    // workoutActive derivation that BottomNav uses. Mount HomePage too
    // so we can assert the §Stale-open recovery card surface (the
    // subject of issue 0019-05) is NOT presented for a finalised
    // session — once that surface lands, the precondition won't fire
    // here either, so the assertion stays valid.
    const { BottomNav } = await import('../app/BottomNav')
    const { HomePage } = await import('../pages/HomePage')
    const { MemoryRouter } = await import('react-router-dom')
    const { WorkoutOverlayProvider } = await import('../pages/live/WorkoutOverlayContext')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    // Build a tiny harness that mounts useBootReconcile alongside the
    // BottomNav, sharing a mutable LiveSessionContext value driven by
    // useReducer so the dispatch actually mutates what BottomNav reads.
    const { useReducer } = await import('react')
    const { liveReducer } = await import('./reducer')

    const getSession = vi.fn().mockResolvedValue(
      sessionRow({ ended_at: '2026-05-17T10:30:00Z' }),
    )

    function Harness() {
      const [state, dispatch] = useReducer(liveReducer, cachedActive)
      return (
        <QueryClientProvider client={queryClient}>
          <LiveSessionContext.Provider value={{ ...state, dispatch }}>
            <WorkoutOverlayProvider>
              <MemoryRouter>
                <Inner />
                <HomePage />
                <BottomNav />
              </MemoryRouter>
            </WorkoutOverlayProvider>
          </LiveSessionContext.Provider>
        </QueryClientProvider>
      )
    }
    function Inner() {
      useBootReconcile({ getSession })
      return null
    }

    const { container, queryByTestId } = render(<Harness />)

    // Before reconcile: nav is locked.
    const workoutLink = container.querySelector('[data-testid="bottom-nav-workout"]')
    expect(workoutLink).not.toBeNull()
    expect(workoutLink?.getAttribute('data-locked')).toBe('true')

    await waitFor(() =>
      expect(
        container
          .querySelector('[data-testid="bottom-nav-workout"]')
          ?.getAttribute('data-locked'),
      ).not.toBe('true'),
    )
    expect(
      container.querySelector('[data-testid="bottom-nav-historie"]')?.getAttribute('data-locked'),
    ).not.toBe('true')
    expect(
      container.querySelector('[data-testid="bottom-nav-profil"]')?.getAttribute('data-locked'),
    ).not.toBe('true')

    // AC6b: the stale-open recovery surface (issue 0019-05) must not
    // present for a finalised session. Trivially passes today (no such
    // surface yet) and will continue to pass once 0019-05 lands because
    // the precondition — a finalised cached session — won't trigger it.
    expect(queryByTestId('stale-open-recovery-card')).toBeNull()
  })

  // AC8: StrictMode regression — React 18 dev mode double-invokes effects
  // (mount → cleanup → mount). The first run's cleanup sets cancelled=true,
  // so dispatch from the first fetch is suppressed. If ran.current is not
  // reset during cleanup, the second mount sees ran.current=true and
  // early-returns — reconciliation silently no-ops in development.
  it('dispatches exactly once under StrictMode double-effect behaviour', async () => {
    const { StrictMode } = await import('react')
    const { useReducer } = await import('react')
    const { liveReducer } = await import('./reducer')

    // Use a deferred promise so we control exactly when the fetch resolves,
    // ensuring we can verify dispatch fires after the StrictMode double-mount.
    let resolveRow!: (row: SessionRow) => void
    const rowPromise = new Promise<SessionRow>((res) => { resolveRow = res })
    const getSession = vi.fn().mockReturnValue(rowPromise)

    const dispatchCalls: LiveAction[] = []
    function Harness() {
      const [state, dispatch] = useReducer(liveReducer, cachedActive)
      const wrappedDispatch = (a: LiveAction) => {
        dispatchCalls.push(a)
        dispatch(a)
      }
      return (
        <LiveSessionContext.Provider value={{ ...state, dispatch: wrappedDispatch }}>
          <Probe />
        </LiveSessionContext.Provider>
      )
    }
    function Probe() {
      useBootReconcile({ getSession })
      return null
    }

    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    )

    // Resolve the fetch after StrictMode's double-mount has settled.
    await act(async () => {
      resolveRow(sessionRow({ ended_at: '2026-05-17T10:30:00Z' }))
    })

    await waitFor(() => expect(dispatchCalls.length).toBeGreaterThan(0))
    // Must fire exactly once — not zero (silent no-op) and not twice.
    expect(dispatchCalls).toHaveLength(1)
    expect(dispatchCalls[0]).toEqual({ type: 'reset', summary: null })
  })

  // AC7: regression — when the BE confirms the cached session is still
  // active (ended_at IS NULL), the hook must NOT unlock BottomNav. The
  // §Stale-open recovery flow owns that surface; the boot hook stays
  // silent so the rower's actually-in-progress workout keeps its lock.
  it('integration: BottomNav stays locked when BE confirms session is still active (AC7)', async () => {
    const { BottomNav } = await import('../app/BottomNav')
    const { MemoryRouter } = await import('react-router-dom')
    const { WorkoutOverlayProvider } = await import('../pages/live/WorkoutOverlayContext')
    const { useReducer } = await import('react')
    const { liveReducer } = await import('./reducer')

    const getSession = vi.fn().mockResolvedValue(
      sessionRow({ ended_at: undefined }),
    )

    function Harness() {
      const [state, dispatch] = useReducer(liveReducer, cachedActive)
      return (
        <LiveSessionContext.Provider value={{ ...state, dispatch }}>
          <WorkoutOverlayProvider>
            <MemoryRouter>
              <Inner />
              <BottomNav />
            </MemoryRouter>
          </WorkoutOverlayProvider>
        </LiveSessionContext.Provider>
      )
    }
    function Inner() {
      useBootReconcile({ getSession })
      return null
    }

    const { container } = render(<Harness />)

    await waitFor(() => expect(getSession).toHaveBeenCalledWith('S1'))
    // Let the resolved promise settle so a (hypothetical) dispatch
    // would have flushed before we assert.
    await act(async () => {
      await Promise.resolve()
    })

    for (const tab of ['workout', 'historie', 'profil']) {
      const el = container.querySelector(`[data-testid="bottom-nav-${tab}"]`)
      expect(el).not.toBeNull()
      expect(el?.getAttribute('data-locked')).toBe('true')
    }
  })
})
