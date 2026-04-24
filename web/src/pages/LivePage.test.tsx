import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LiveSessionContext } from '../live/LiveSessionContext'
import { initialLiveState, type LiveState } from '../live/reducer'
import type { SessionEndSummary } from '../live/events'
import { LivePage } from './LivePage'

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
})
