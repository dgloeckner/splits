import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LiveSessionContext } from '../live/LiveSessionContext'
import { initialLiveState, type LiveState } from '../live/reducer'
import type { SessionEndSummary } from '../live/events'
import type { BannerState } from './live/usePBBanners'
import { LivePage } from './LivePage'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub

const mockBannerState = vi.hoisted(() => ({ current: { kind: 'idle' } as BannerState }))
vi.mock('./live/usePBBanners', () => ({
  usePBBanners: () => mockBannerState.current,
}))

const mockWorkoutProgress = vi.hoisted(
  () => ({ current: null as null | Record<string, unknown> }),
)
vi.mock('../live/useWorkoutProgress', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return {
    ...real,
    useWorkoutProgress: () =>
      mockWorkoutProgress.current ?? {
        segments: [],
        active: null,
        workoutId: null,
        isLoading: false,
        workout: null,
      },
  }
})

const mockRaceData = vi.hoisted(() => ({ current: { ghost: null, pb: null } as { ghost: unknown; pb: unknown } }))
vi.mock('../race/useRaceData', () => ({
  useRaceData: () => mockRaceData.current,
}))

beforeEach(() => {
  mockBannerState.current = { kind: 'idle' }
  mockWorkoutProgress.current = null
  mockRaceData.current = { ghost: null, pb: null }
})

function wrapRender(state: LiveState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <LiveSessionContext.Provider value={state}>
        <MemoryRouter initialEntries={['/live']}>
          <Routes>
            <Route path="/live" element={<LivePage />} />
            <Route path="/" element={<div>HOME</div>} />
          </Routes>
        </MemoryRouter>
      </LiveSessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('LivePage session-end overlay', () => {
  it('does not show overlay when summary is null', () => {
    wrapRender({ ...initialLiveState, summary: null })
    expect(screen.queryByTestId('session-ended-overlay')).toBeNull()
  })

  it('shows overlay when session ends; OK navigates home', async () => {
    const summary: SessionEndSummary = {
      total_distance_m: 5000, total_time_sec: 1800, total_strokes: 540,
      avg_power_w: 150, peak_power_w: 220, avg_spm: 26, avg_dps: 9.5,
      avg_pace_sec_per_500m: 120, session_calories: 300,
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <LiveSessionContext.Provider value={{ ...initialLiveState, summary: null }}>
          <MemoryRouter initialEntries={['/live']}>
            <Routes>
              <Route path="/live" element={<LivePage />} />
              <Route path="/" element={<div>HOME</div>} />
            </Routes>
          </MemoryRouter>
        </LiveSessionContext.Provider>
      </QueryClientProvider>,
    )
    expect(screen.queryByTestId('session-ended-overlay')).toBeNull()
    act(() => {
      rerender(
        <QueryClientProvider client={qc}>
          <LiveSessionContext.Provider value={{ ...initialLiveState, summary }}>
            <MemoryRouter initialEntries={['/live']}>
              <Routes>
                <Route path="/live" element={<LivePage />} />
                <Route path="/" element={<div>HOME</div>} />
              </Routes>
            </MemoryRouter>
          </LiveSessionContext.Provider>
        </QueryClientProvider>,
      )
    })
    expect(screen.getByTestId('session-ended-overlay')).toBeInTheDocument()
    expect(screen.queryByText('HOME')).toBeNull()
    await userEvent.click(screen.getByTestId('session-ended-ok'))
    expect(await screen.findByText('HOME')).toBeInTheDocument()
  })

  it('shows PBOverlay before SessionEndedOverlay when PBs exist; Weiter falls through to summary', async () => {
    mockBannerState.current = {
      kind: 'resolved',
      banners: {
        distance: [
          {
            distance_m: 2000,
            time_sec: 480,
            source_session_id: 'S1',
            source_session_started_at: '2026-04-27T12:00:00Z',
            achieved_at: '2026-04-27T12:00:00Z',
          },
        ],
        window: [],
      },
    }
    const summary: SessionEndSummary = {
      total_distance_m: 5000, total_time_sec: 1800, total_strokes: 540,
      avg_power_w: 150, peak_power_w: 220, avg_spm: 26, avg_dps: 9.5,
      avg_pace_sec_per_500m: 120, session_calories: 300,
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <LiveSessionContext.Provider value={{ ...initialLiveState, summary: null }}>
          <MemoryRouter initialEntries={['/live']}>
            <Routes>
              <Route path="/live" element={<LivePage />} />
              <Route path="/" element={<div>HOME</div>} />
            </Routes>
          </MemoryRouter>
        </LiveSessionContext.Provider>
      </QueryClientProvider>,
    )
    act(() => {
      rerender(
        <QueryClientProvider client={qc}>
          <LiveSessionContext.Provider
            value={{
              ...initialLiveState,
              summary,
              session: {
                session_id: 'S1',
                started_at: '2026-04-27T12:00:00Z',
                rower_id: 'R1',
                rower_name: 'Daniel',
                initial_level: 5,
              },
            }}
          >
            <MemoryRouter initialEntries={['/live']}>
              <Routes>
                <Route path="/live" element={<LivePage />} />
                <Route path="/" element={<div>HOME</div>} />
              </Routes>
            </MemoryRouter>
          </LiveSessionContext.Provider>
        </QueryClientProvider>,
      )
    })
    // PBOverlay shown first; SessionEndedOverlay hidden behind it.
    expect(screen.getByTestId('pb-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('session-ended-overlay')).toBeNull()
    // "Weiter" on the only PB dismisses overlay → summary appears.
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(screen.queryByTestId('pb-overlay')).toBeNull()
    expect(screen.getByTestId('session-ended-overlay')).toBeInTheDocument()
  })

  it('invalidates rower-pbs / lifetime / achievements / trends on session-end so Rekorde grid reflects the new PB', () => {
    // Regression: a household member finished a 1 km row that set a
    // new PB, the live page modal showed "Neue Bestzeit · 1 km", but
    // the Rekorde tab still rendered "—" for the 1 km card. Cause:
    // the rower-pbs query was warmed earlier in the same tab (e.g.
    // from a previous Rekorde visit) and never invalidated when the
    // session ended, so the cached pre-session PB list kept winning
    // until something else triggered a refetch. Test asserts the
    // invalidation contract on the null → summary transition.
    const summary: SessionEndSummary = {
      total_distance_m: 1035, total_time_sec: 284, total_strokes: 124,
      avg_power_w: 259, peak_power_w: 322, avg_spm: 26, avg_dps: 8.35,
      avg_pace_sec_per_500m: 137, session_calories: 112,
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <LiveSessionContext.Provider value={{ ...initialLiveState, summary: null }}>
          <MemoryRouter initialEntries={['/live']}>
            <Routes>
              <Route path="/live" element={<LivePage />} />
              <Route path="/" element={<div>HOME</div>} />
            </Routes>
          </MemoryRouter>
        </LiveSessionContext.Provider>
      </QueryClientProvider>,
    )
    invalidate.mockClear()
    act(() => {
      rerender(
        <QueryClientProvider client={qc}>
          <LiveSessionContext.Provider value={{ ...initialLiveState, summary }}>
            <MemoryRouter initialEntries={['/live']}>
              <Routes>
                <Route path="/live" element={<LivePage />} />
                <Route path="/" element={<div>HOME</div>} />
              </Routes>
            </MemoryRouter>
          </LiveSessionContext.Provider>
        </QueryClientProvider>,
      )
    })
    const invalidatedKeys = invalidate.mock.calls
      .map((c) => (c[0] as { queryKey?: readonly unknown[] } | undefined)?.queryKey?.[0])
      .filter((k): k is string => typeof k === 'string')
    expect(invalidatedKeys).toContain('rower-pbs')
    expect(invalidatedKeys).toContain('rower-lifetime')
    expect(invalidatedKeys).toContain('rower-achievements')
    expect(invalidatedKeys).toContain('rower-trends')
  })

  it('renders RaceLiveView when active workout mode is race', () => {
    mockWorkoutProgress.current = {
      segments: [],
      active: null,
      workoutId: 'W-RACE',
      isLoading: false,
      workout: {
        id: 'W-RACE',
        mode: 'race',
        params: { meters: 2000 },
        intensity: null,
      },
    }
    wrapRender({
      ...initialLiveState,
      session: {
        session_id: 'S1',
        started_at: '2026-04-27T12:00:00Z',
        rower_id: 'R1',
        rower_name: 'Daniel',
        initial_level: 5,
        workout_id: 'W-RACE',
      },
    })
    expect(document.querySelector('[data-component="race-canvas"]')).not.toBeNull()
    expect(document.querySelector('[data-component="tile-grid"]')).toBeNull()
  })

  it('skips PBOverlay and shows summary directly when no PBs are present', () => {
    mockBannerState.current = {
      kind: 'resolved',
      banners: { distance: [], window: [] },
    }
    const summary: SessionEndSummary = {
      total_distance_m: 5000, total_time_sec: 1800, total_strokes: 540,
      avg_power_w: 150, peak_power_w: 220, avg_spm: 26, avg_dps: 9.5,
      avg_pace_sec_per_500m: 120, session_calories: 300,
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <LiveSessionContext.Provider value={{ ...initialLiveState, summary: null }}>
          <MemoryRouter initialEntries={['/live']}>
            <Routes>
              <Route path="/live" element={<LivePage />} />
              <Route path="/" element={<div>HOME</div>} />
            </Routes>
          </MemoryRouter>
        </LiveSessionContext.Provider>
      </QueryClientProvider>,
    )
    act(() => {
      rerender(
        <QueryClientProvider client={qc}>
          <LiveSessionContext.Provider value={{ ...initialLiveState, summary }}>
            <MemoryRouter initialEntries={['/live']}>
              <Routes>
                <Route path="/live" element={<LivePage />} />
                <Route path="/" element={<div>HOME</div>} />
              </Routes>
            </MemoryRouter>
          </LiveSessionContext.Provider>
        </QueryClientProvider>,
      )
    })
    expect(screen.queryByTestId('pb-overlay')).toBeNull()
    expect(screen.getByTestId('session-ended-overlay')).toBeInTheDocument()
  })
})
