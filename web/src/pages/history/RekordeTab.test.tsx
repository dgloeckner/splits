import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { RekordeTab } from './RekordeTab'

vi.mock('../../api/rowers', () => ({
  getActiveRower: vi.fn(async () => ({
    id: 'R1',
    name: 'Test',
    color: '#fff',
    created_at: '2026-01-01T00:00:00Z',
  })),
}))

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RekordeTab />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function mockBackend(opts: {
  pbs?: { distance: unknown[]; window: unknown[]; workout: unknown[] }
  achievements?: unknown[]
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/pbs')) {
        return new Response(
          JSON.stringify(opts.pbs ?? { distance: [], window: [], workout: [] }),
          { status: 200 },
        )
      }
      if (url.includes('/achievements')) {
        return new Response(JSON.stringify({ achievements: opts.achievements ?? [] }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }),
  )
}

describe('RekordeTab', () => {
  it('renders empty state when no PBs and no achievements', async () => {
    mockBackend({})
    renderTab()
    await waitFor(() =>
      expect(screen.getByText(/Noch keine Bestleistungen/)).toBeInTheDocument(),
    )
  })

  it('renders distance grid with placeholders for missing distances', async () => {
    mockBackend({
      pbs: {
        distance: [{ distance_m: 2000, time_sec: 480, achieved_at: '2026-04-01T10:00:00Z' }],
        window: [],
        workout: [],
      },
    })
    renderTab()
    await waitFor(() =>
      expect(screen.getByText(/Persönliche Bestzeiten · Distanzen/)).toBeInTheDocument(),
    )
    expect(screen.getAllByText('8:00').length).toBeGreaterThanOrEqual(1)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(5)
  })

  it('renders milestones strip when achievements include volume entries', async () => {
    mockBackend({
      pbs: {
        distance: [{ distance_m: 1000, time_sec: 240, achieved_at: '2026-04-01T10:00:00Z' }],
        window: [],
        workout: [],
      },
      achievements: [
        { type: 'volume', key: 'distance_10000m', value: 10000 },
      ],
    })
    renderTab()
    await waitFor(() => expect(screen.getByText(/Meilensteine/)).toBeInTheDocument())
    expect(screen.getAllByText(/10 km Gesamt/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders hero card with newest PB and delta when previous_time_sec present', async () => {
    mockBackend({
      pbs: {
        distance: [
          {
            distance_m: 500,
            time_sec: 134,
            previous_time_sec: 137,
            achieved_at: new Date(Date.now() - 86_400_000).toISOString(),
            source_session_started_at: new Date(Date.now() - 86_400_000).toISOString(),
            source_session_id: 'S1',
          },
        ],
        window: [],
        workout: [],
      },
    })
    renderTab()
    await waitFor(() => expect(screen.getByText('NEUESTER ERFOLG')).toBeInTheDocument())
    expect(screen.getByText(/NEUE BESTZEIT · 500 M/)).toBeInTheDocument()
    expect(screen.getByText(/-3s vs\. vorher/)).toBeInTheDocument()
  })

  it('scrolls and flashes the row matching the URL hash', async () => {
    window.history.replaceState(null, '', '/historie/rekorde#pb-distance-500')
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy as unknown as Element['scrollIntoView']

    mockBackend({
      pbs: {
        distance: [
          {
            distance_m: 500,
            time_sec: 134,
            achieved_at: '2026-04-01T10:00:00Z',
            source_session_started_at: '2026-04-01T10:00:00Z',
            source_session_id: 'S1',
          },
        ],
        window: [],
        workout: [],
      },
    })
    renderTab()
    await waitFor(() =>
      expect(screen.getByText(/Persönliche Bestzeiten · Distanzen/)).toBeInTheDocument(),
    )

    await waitFor(() => {
      const row = document.getElementById('pb-distance-500')
      expect(row).toBeTruthy()
      expect(row?.className).toContain('flash')
    })
    expect(scrollSpy).toHaveBeenCalled()

    window.history.replaceState(null, '', '/')
  })

  it('renders achievement timeline with PB events sorted newest first', async () => {
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const recent = new Date(Date.now() - 1 * 86_400_000).toISOString()
    mockBackend({
      pbs: {
        distance: [
          {
            distance_m: 2000,
            time_sec: 480,
            achieved_at: old,
            source_session_started_at: old,
            source_session_id: 'S0',
          },
          {
            distance_m: 500,
            time_sec: 134,
            achieved_at: recent,
            source_session_started_at: recent,
            source_session_id: 'S1',
          },
        ],
        window: [],
        workout: [],
      },
    })
    renderTab()
    await waitFor(() => expect(screen.getByText(/Achievement-Verlauf/)).toBeInTheDocument())
    const labels = screen.getAllByText(/Neue Bestzeit ·/)
    // First timeline row is the recent 500 m, second is older 2000 m.
    const timelineLabels = labels.filter((el) => el.className.includes('timelineLabel'))
    expect(timelineLabels[0].textContent).toMatch(/500 m · 2:14/)
    expect(timelineLabels[1].textContent).toMatch(/2 k · 8:00/)
  })
})
