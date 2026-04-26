import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FavoritesList } from './FavoritesList'

const originalFetch = global.fetch
type R = { body: string | null; status: number }
function mockRoutes(routes: Record<string, R | ((init?: RequestInit) => R)>) {
  global.fetch = vi.fn(async (url, init) => {
    const key = String(url).split('?')[0]
    const raw = String(url)
    const v = routes[raw] ?? routes[key]
    if (!v) return new Response('not found', { status: 404 })
    const r = typeof v === 'function' ? v(init) : v
    return new Response(r.body, { status: r.status, headers: r.body ? { 'content-type': 'application/json' } : undefined })
  }) as typeof fetch
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/live" element={<div>LIVE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => { global.fetch = originalFetch })

describe('FavoritesList', () => {
  it('renders nothing when there are no favorites', async () => {
    mockRoutes({ '/api/v1/favorites': { body: JSON.stringify({ favorites: [] }), status: 200 } })
    const { container } = wrap(<FavoritesList rowerID="R1" />)
    await waitFor(() =>
      expect(container.querySelector('[data-testid="favorites-list"]')).toBeNull(),
    )
  })

  it('renders items with formatted summary', async () => {
    mockRoutes({
      '/api/v1/favorites': { body: JSON.stringify({ favorites: [
        { id: 'F1', rower_id: 'R1', name: 'My 5k', mode: 'distance', params: { meters: 5000 }, intensity: 'moderat', warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-22T08:00:00Z' },
        { id: 'F2', rower_id: 'R1', name: 'Sprints', mode: 'intervals', params: { reps: 6, length: { unit: 'm', value: 500 }, rest_sec: 120 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-22T07:00:00Z' },
      ]}), status: 200 },
    })
    wrap(<FavoritesList rowerID="R1" />)
    expect(await screen.findByText('My 5k')).toBeInTheDocument()
    expect(screen.getByText(/5 km/)).toBeInTheDocument()
    expect(screen.getByText(/moderat/i)).toBeInTheDocument()
    expect(screen.getByText('Sprints')).toBeInTheDocument()
    expect(screen.getByText(/6×500m/)).toBeInTheDocument()
    expect(screen.getByText(/2 min Pause/)).toBeInTheDocument()
  })

  it('tapping item triggers createWorkout + attach + navigate', async () => {
    let createdBody: unknown = null
    let attached = false
    mockRoutes({
      '/api/v1/favorites': { body: JSON.stringify({ favorites: [
        { id: 'F1', rower_id: 'R1', name: 'My 5k', mode: 'distance', params: { meters: 5000 }, intensity: 'moderat', warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-22T08:00:00Z' },
      ]}), status: 200 },
      '/api/v1/workouts': (init) => {
        if (init?.method === 'POST') createdBody = JSON.parse(init.body as string)
        return { body: JSON.stringify({ id: 'W1', mode: 'distance', params: { meters: 5000 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-23T00:00:00Z' }), status: 201 }
      },
      '/api/v1/session/start': () => { attached = true; return { body: null, status: 204 } },
    })

    wrap(<FavoritesList rowerID="R1" />)
    await userEvent.click(await screen.findByRole('button', { name: /my 5k/i }))
    await waitFor(() => expect(screen.getByText('LIVE')).toBeInTheDocument())
    expect(createdBody && (createdBody as { mode: string }).mode).toBe('distance')
    expect(attached).toBe(true)
  })

  it('delete button removes the favorite', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let listCall = 0
    mockRoutes({
      '/api/v1/favorites': () => {
        listCall++
        if (listCall === 1) return { body: JSON.stringify({ favorites: [
          { id: 'F1', rower_id: 'R1', name: 'My 5k', mode: 'distance', params: { meters: 5000 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-22T08:00:00Z' },
        ]}), status: 200 }
        return { body: JSON.stringify({ favorites: [] }), status: 200 }
      },
      '/api/v1/favorites/F1': () => ({ body: null, status: 204 }),
    })

    wrap(<FavoritesList rowerID="R1" />)
    await userEvent.click(await screen.findByRole('button', { name: /löschen/i }))
    await waitFor(() => expect(screen.queryByText('My 5k')).toBeNull())
  })
})
