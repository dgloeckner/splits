import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LastTrainingCard } from './LastTrainingCard'

const originalFetch = global.fetch

type RouteConfig = { body: string | null; status: number }
function mockRoutes(routes: Record<string, RouteConfig | ((init?: RequestInit) => RouteConfig)>) {
  global.fetch = vi.fn(async (url, init) => {
    const key = String(url)
    const v = routes[key] ?? routes[key.split('?')[0]]
    if (!v) return new Response('not found', { status: 404 })
    const r = typeof v === 'function' ? v(init) : v
    return new Response(r.body, { status: r.status, headers: r.body ? { 'content-type': 'application/json' } : undefined })
  }) as typeof fetch
}

function wrap(ui: React.ReactNode, initialEntries = ['/']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/live" element={<div>LIVE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => { global.fetch = originalFetch })

describe('LastTrainingCard', () => {
  it('renders nothing when no session for this rower', async () => {
    mockRoutes({
      '/api/v1/sessions': { body: JSON.stringify({ sessions: [{ id: 'S1', rower_id: 'OTHER', started_at: '2026-04-22T08:00:00Z', initial_level: 3, total_distance_m: 2000, total_time_sec: 900 }] }), status: 200 },
    })
    const { container } = wrap(<LastTrainingCard rowerID="R1" />)
    await waitFor(() => expect(container.querySelector('[data-testid="last-training-card"]')).toBeNull())
  })

  it('renders session summary + Wiederholen for matching rower', async () => {
    mockRoutes({
      '/api/v1/sessions': { body: JSON.stringify({ sessions: [{ id: 'S1', rower_id: 'R1', started_at: '2026-04-22T08:00:00Z', ended_at: '2026-04-22T08:30:00Z', initial_level: 3, total_distance_m: 5000, total_time_sec: 1800 }] }), status: 200 },
    })
    wrap(<LastTrainingCard rowerID="R1" />)
    expect(await screen.findByTestId('last-training-card')).toBeInTheDocument()
    expect(screen.getByText(/5,00 km/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /wiederholen/i })).toBeInTheDocument()
  })

  it('Wiederholen triggers createWorkout + attach + navigate', async () => {
    let createdBody: unknown = null
    let attached = false
    mockRoutes({
      '/api/v1/sessions': { body: JSON.stringify({ sessions: [{ id: 'S1', rower_id: 'R1', started_at: '2026-04-22T08:00:00Z', initial_level: 3, total_distance_m: 2000, total_time_sec: 900 }] }), status: 200 },
      '/api/v1/workouts/last': { body: JSON.stringify({ id: 'W1', mode: 'distance', params: { meters: 2000 }, intensity: 'moderat', warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-22T08:00:00Z' }), status: 200 },
      '/api/v1/workouts': (init) => {
        if (init?.method === 'POST') createdBody = JSON.parse(init.body as string)
        return { body: JSON.stringify({ id: 'W2', mode: 'distance', params: { meters: 2000 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-23T08:00:00Z' }), status: 201 }
      },
      '/api/v1/workouts/W2/attach': () => { attached = true; return { body: null, status: 204 } },
    })

    wrap(<LastTrainingCard rowerID="R1" />)
    await userEvent.click(await screen.findByRole('button', { name: /wiederholen/i }))
    await waitFor(() => expect(screen.getByText('LIVE')).toBeInTheDocument())
    expect(createdBody && (createdBody as { mode: string }).mode).toBe('distance')
    expect(attached).toBe(true)
  })
})
