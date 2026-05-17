import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StaleSessionCard } from './StaleSessionCard'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

function renderCard(rowerID: string | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<StaleSessionCard rowerID={rowerID} />} />
          <Route path="/live" element={<div>LIVE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const sampleStale = {
  id: 'S-stale',
  started_at: '2026-05-10T10:00:00Z',
  last_stroke_at: '2026-05-10T10:20:00Z',
  total_distance_m: 4200,
  workout_id: '',
}

const sampleRaceStale = {
  id: 'S-race',
  started_at: '2026-05-10T10:00:00Z',
  last_stroke_at: '2026-05-10T10:20:00Z',
  total_distance_m: 1800,
  workout_id: 'W-race',
  mode: 'race',
}

describe('StaleSessionCard', () => {
  it('renders nothing when no stale sessions', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ sessions: [] }), { status: 200 }),
    ) as typeof fetch
    const { container } = renderCard('R1')
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders a card with three action buttons when a stale session exists', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/v1/sessions/stale-open')) {
        return new Response(JSON.stringify({ sessions: [sampleStale] }), { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
    renderCard('R1')
    expect(await screen.findByText(/Frühere Session abschließen/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Beenden mit gerudertem Stand/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Verwerfen/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Weiter rudern/i })).toBeInTheDocument()
  })

  it('Beenden calls POST finalize and refetches', async () => {
    let finalized = false
    let listCalls = 0
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/v1/sessions/stale-open')) {
        listCalls++
        return new Response(
          JSON.stringify({ sessions: finalized ? [] : [sampleStale] }),
          { status: 200 },
        )
      }
      if (u === '/api/v1/sessions/S-stale/finalize' && init?.method === 'POST') {
        finalized = true
        return new Response(null, { status: 204 })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
    renderCard('R1')
    await userEvent.click(await screen.findByRole('button', { name: /Beenden mit gerudertem Stand/i }))
    await waitFor(() => expect(finalized).toBe(true))
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2))
  })

  it('Verwerfen calls DELETE and refetches', async () => {
    let deleted = false
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/v1/sessions/stale-open')) {
        return new Response(
          JSON.stringify({ sessions: deleted ? [] : [sampleStale] }),
          { status: 200 },
        )
      }
      if (u === '/api/v1/sessions/S-stale' && init?.method === 'DELETE') {
        deleted = true
        return new Response(null, { status: 204 })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
    renderCard('R1')
    await userEvent.click(await screen.findByRole('button', { name: /Verwerfen/i }))
    await waitFor(() => expect(deleted).toBe(true))
  })

  it('Weiter rudern navigates to /live', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/v1/sessions/stale-open')) {
        return new Response(JSON.stringify({ sessions: [sampleStale] }), { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
    renderCard('R1')
    await userEvent.click(await screen.findByRole('button', { name: /Weiter rudern/i }))
    expect(await screen.findByText('LIVE')).toBeInTheDocument()
  })

  it('renders nothing without a rowerID', () => {
    const { container } = renderCard(undefined)
    expect(container.firstChild).toBeNull()
  })

  // ADR-0012 / PRD-0014 issue 08: race rows are non-resumable.
  it('hides "Weiter rudern" for race-mode rows (ADR-0012)', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/v1/sessions/stale-open')) {
        return new Response(JSON.stringify({ sessions: [sampleRaceStale] }), { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
    renderCard('R1')
    expect(await screen.findByRole('button', { name: /Beenden mit gerudertem Stand/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Verwerfen/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Weiter rudern/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('stale-recovery-rejoin')).not.toBeInTheDocument()
  })

  it('renders all three actions for non-race rows (regression guard)', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/v1/sessions/stale-open')) {
        return new Response(
          JSON.stringify({ sessions: [{ ...sampleStale, mode: 'distance' }] }),
          { status: 200 },
        )
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
    renderCard('R1')
    expect(await screen.findByRole('button', { name: /Beenden mit gerudertem Stand/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Verwerfen/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Weiter rudern/i })).toBeInTheDocument()
  })
})
