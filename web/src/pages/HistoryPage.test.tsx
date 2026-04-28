import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HistoryPage } from './HistoryPage'
import { SessionsTab } from './history/SessionsTab'

function mockFetch(sessions: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/v1/active-rower')) {
        return new Response(
          JSON.stringify({ id: 'R', name: 'A', color: '#fff', created_at: '2026-04-21T00:00:00Z' }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ sessions }), { status: 200 })
    }),
  )
}

function wrap(initialPath = '/historie') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/historie" element={<HistoryPage />}>
            <Route index element={<SessionsTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HistoryPage shell', () => {
  it('renders the sub-nav with Sessions, Trends, and Rekorde links', async () => {
    mockFetch([])
    wrap()
    expect(screen.getByRole('link', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Trends' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rekorde' })).toBeInTheDocument()
  })

  it('renders an empty state when backend returns no sessions', async () => {
    mockFetch([])
    wrap()
    await waitFor(() => expect(screen.getByText(/Noch keine Sessions/)).toBeInTheDocument())
  })

  it('renders one row per returned session', async () => {
    mockFetch([
      {
        id: 'S1',
        rower_id: 'R',
        started_at: new Date().toISOString(),
        initial_level: 3,
        total_distance_m: 1035,
        total_time_sec: 284,
        summary: { avg_pace_sec_per_500m: 137 },
      },
    ])
    wrap()
    await waitFor(() => expect(screen.getByText(/Heute \d{2}:\d{2}/)).toBeInTheDocument())
    expect(screen.getByText('1035 m')).toBeInTheDocument()
  })
})
