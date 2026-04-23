import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { LiveSessionContext } from '../live/LiveSessionContext'
import { initialLiveState, type LiveState } from '../live/reducer'
import type { SessionEndSummary } from '../live/events'
import { LivePage } from './LivePage'

// Minimal provider that lets the test change state between renders.
function wrapRender(state: LiveState) {
  return render(
    <LiveSessionContext.Provider value={state}>
      <MemoryRouter initialEntries={['/live']}>
        <Routes>
          <Route path="/live" element={<LivePage />} />
          <Route path="/" element={<div>HOME</div>} />
        </Routes>
      </MemoryRouter>
    </LiveSessionContext.Provider>,
  )
}

describe('LivePage session-end navigation', () => {
  it('does not navigate when summary starts null', () => {
    wrapRender({ ...initialLiveState, summary: null })
    expect(screen.queryByText('HOME')).toBeNull()
  })

  it('navigates to / when summary transitions to a value', async () => {
    const summary: SessionEndSummary = {
      total_distance_m: 5000, total_time_sec: 1800, total_strokes: 540,
      avg_power_w: 150, peak_power_w: 220, avg_spm: 26, avg_dps: 9.5, avg_pace_sec_per_500m: 120, session_calories: 300,
    }
    const { rerender } = render(
      <LiveSessionContext.Provider value={{ ...initialLiveState, summary: null }}>
        <MemoryRouter initialEntries={['/live']}>
          <Routes>
            <Route path="/live" element={<LivePage />} />
            <Route path="/" element={<div>HOME</div>} />
          </Routes>
        </MemoryRouter>
      </LiveSessionContext.Provider>,
    )
    expect(screen.queryByText('HOME')).toBeNull()
    act(() => {
      rerender(
        <LiveSessionContext.Provider value={{ ...initialLiveState, summary }}>
          <MemoryRouter initialEntries={['/live']}>
            <Routes>
              <Route path="/live" element={<LivePage />} />
              <Route path="/" element={<div>HOME</div>} />
            </Routes>
          </MemoryRouter>
        </LiveSessionContext.Provider>,
      )
    })
    expect(await screen.findByText('HOME')).toBeInTheDocument()
  })
})
