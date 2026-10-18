import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SessionDetailPage } from './SessionDetailPage'
import * as insightsApi from '../api/insights'
import { _resetErgoStatusForTest, setErgoStatus } from '../offline/ergoStatus'

function wrap(initial = '/historie/S1', qc?: QueryClient) {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/historie" element={<p>Historie</p>} />
          <Route path="/historie/:sessionId" element={<SessionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  _resetErgoStatusForTest()
})

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
        '/api/v1/sessions/S1/pb-banners': () =>
          new Response(JSON.stringify({ distance: [], window: [] }), { status: 200 }),
        '/api/v1/sessions/S1': () => new Response(JSON.stringify(SESSION), { status: 200 }),
      }),
    )
    render(wrap())
    await waitFor(() => expect(screen.getByText('1035 m')).toBeInTheDocument())
    expect(screen.getByText(/Split-Verlauf/)).toBeInTheDocument()
    expect(screen.getByText(/Watt-Verlauf/)).toBeInTheDocument()
    expect(screen.getByText(/SPM-Verlauf/)).toBeInTheDocument()
  })

  it('renders Auswertung section when insights are available', async () => {
    vi.spyOn(insightsApi, 'getSessionInsights').mockResolvedValue({
      findings: [
        {
          detector_id: 'pacing',
          code: 'POSITIVE_SPLIT',
          severity: 'NOTABLE',
          category: 'PACING',
          message_de: 'Positiver Split erkannt.',
          evidence: { first_half_pace: 130, second_half_pace: 144 },
        },
      ],
      synthesisDe: 'Gute Leistung insgesamt.',
    })
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/v1/sessions/S1/samples': () => new Response(JSON.stringify({ samples: SAMPLES }), { status: 200 }),
        '/api/v1/sessions/S1/pb-banners': () =>
          new Response(JSON.stringify({ distance: [], window: [] }), { status: 200 }),
        '/api/v1/sessions/S1': () => new Response(JSON.stringify(SESSION), { status: 200 }),
      }),
    )
    render(wrap())
    await waitFor(() => expect(screen.getByText('1035 m')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Auswertung')).toBeInTheDocument())
    expect(screen.getByText('Gute Leistung insgesamt.')).toBeInTheDocument()
  })

  it('renders cached session data even when the refetch errors', async () => {
    _resetErgoStatusForTest()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['sessions', 'S1'], SESSION)
    qc.setQueryData(['sessions', 'S1', 'samples'], [])
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('unreachable')))

    render(wrap('/historie/S1', qc))

    expect(await screen.findByTestId('detail-total-distance')).toBeInTheDocument()
    expect(screen.queryByText('Session nicht gefunden.')).toBeNull()
  })

  it('shows not-found copy only on a real 404', async () => {
    vi.stubGlobal('fetch', mockFetch({}))
    render(wrap())
    await waitFor(() =>
      expect(screen.getByText('Session nicht gefunden.')).toBeInTheDocument(),
    )
  })

  it('shows the offline copy with a retry on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Load failed')
      }),
    )
    render(wrap())
    await waitFor(() =>
      expect(screen.getByText(/konnte nicht geladen werden/)).toBeInTheDocument(),
    )
    expect(screen.queryByText('Session nicht gefunden.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
  })

  it('delete button opens confirm dialog; confirm navigates back', async () => {
    const fetchMock = mockFetch({
      '/api/v1/sessions/S1/samples': () => new Response(JSON.stringify({ samples: SAMPLES }), { status: 200 }),
      '/api/v1/sessions/S1/pb-banners': () =>
        new Response(JSON.stringify({ distance: [], window: [] }), { status: 200 }),
      '/api/v1/sessions/S1': (init) => {
        if (init?.method === 'DELETE') return new Response(null, { status: 204 })
        return new Response(JSON.stringify(SESSION), { status: 200 })
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    render(wrap())
    await waitFor(() => expect(screen.getByText('1035 m')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('session-detail-delete'))
    expect(screen.getByTestId('delete-session-dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('delete-session-confirm'))
    await waitFor(() => expect(screen.getByText('Historie')).toBeInTheDocument())
  })

  // Issue #9 (option B): away from home, a session outside the pack is
  // a friendly note, not an error screen.
  it('away from home: a session in neither store is „Nicht im Rucksack“', async () => {
    setErgoStatus({ reachable: false, packedAt: '2026-06-12T10:00:00' })
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('unreachable')))
    render(wrap())
    expect(await screen.findByTestId('session-not-packed')).toHaveTextContent(
      'Nicht im Rucksack — zuhause öffnet sich die Session wieder',
    )
    expect(screen.queryByText(/konnte nicht geladen werden/)).toBeNull()
    expect(screen.getByRole('link', { name: /Zurück/ })).toHaveAttribute('href', '/historie')
    expect(screen.getByTestId('ergo-stand-banner')).toBeInTheDocument()
  })
})
