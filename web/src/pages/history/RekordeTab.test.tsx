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
    expect(screen.getByText('8:00')).toBeInTheDocument()
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
    expect(screen.getByText(/10 km Gesamt/)).toBeInTheDocument()
  })
})
