import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SessionDetailPage } from './SessionDetailPage'

function wrap(initial = '/historie/S1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/historie" element={<p>Historie</p>} />
          <Route path="/historie/:sessionId" element={<SessionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = String(url)
    for (const [pattern, fn] of Object.entries(handlers)) {
      if (key === pattern || key.startsWith(pattern)) return fn(init)
    }
    return new Response('', { status: 404 })
  })
}

const SESSION = {
  id: 'S1',
  rower_id: 'R',
  started_at: new Date().toISOString(),
  initial_level: 3,
  total_distance_m: 1035,
  total_time_sec: 284,
  total_strokes: 124,
  summary: {
    total_distance_m: 1035,
    total_time_sec: 284,
    total_strokes: 124,
    avg_power_w: 259,
    peak_power_w: 322,
    avg_spm: 26.3,
    avg_dps: 8.35,
    avg_pace_sec_per_500m: 137,
    session_calories: 112,
  },
}

const SAMPLES = [
  { stroke_no: 1, time_sec: 2, distance_m: 8, spm: 25, power_w: 200, cal_per_hr: 1000, level: 3, dps: 8, stroke_cycle_sec: 2, pace_sec_per_500m: 125, energy_joules: 400 },
  { stroke_no: 2, time_sec: 4, distance_m: 16, spm: 27, power_w: 220, cal_per_hr: 1000, level: 3, dps: 8, stroke_cycle_sec: 2, pace_sec_per_500m: 125, energy_joules: 440 },
]

describe('SessionDetailPage', () => {
  it('renders hero + three charts for a session', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/v1/sessions/S1/samples': () => new Response(JSON.stringify({ samples: SAMPLES }), { status: 200 }),
        '/api/v1/sessions/S1': () => new Response(JSON.stringify(SESSION), { status: 200 }),
      }),
    )
    render(wrap())
    await waitFor(() => expect(screen.getByText('1035 m')).toBeInTheDocument())
    expect(screen.getByText(/Split-Verlauf/)).toBeInTheDocument()
    expect(screen.getByText(/Watt-Verlauf/)).toBeInTheDocument()
    expect(screen.getByText(/SPM-Verlauf/)).toBeInTheDocument()
  })

  it('delete button navigates back on success', async () => {
    const fetchMock = mockFetch({
      '/api/v1/sessions/S1/samples': () => new Response(JSON.stringify({ samples: SAMPLES }), { status: 200 }),
      '/api/v1/sessions/S1': (init) => {
        if (init?.method === 'DELETE') return new Response(null, { status: 204 })
        return new Response(JSON.stringify(SESSION), { status: 200 })
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(wrap())
    await waitFor(() => expect(screen.getByText('1035 m')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Löschen' }))
    await waitFor(() => expect(screen.getByText('Historie')).toBeInTheDocument())
  })
})
