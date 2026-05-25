import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TrendsTab } from './TrendsTab'
import type { TrendsRange, TrendsResponse } from '../../api/client'

function trendsBody(over: Partial<{ sessions: number; range: TrendsRange }> = {}): TrendsResponse {
  return {
    range: over.range ?? 'month',
    period: { label: 'Diesen Monat', from: '', to: '' },
    totals: { distance_m: 12_000, active_sec: 5_400, sessions: over.sessions ?? 3 },
    prior: { distance_m: 10_000, active_sec: 4_000, sessions: 2 },
    performance: {
      points: [
        { t: '2026-04-01T10:00:00Z', avg_power_w: 200, avg_pace_sec_per_500m: 130 },
        { t: '2026-04-10T10:00:00Z', avg_power_w: 215, avg_pace_sec_per_500m: 124 },
      ],
      avg_power_w: 207,
      avg_pace_sec_per_500m: 127,
    },
    efficiency: {
      points: [
        { t: '2026-04-01T10:00:00Z', avg_dps: 9.5, avg_spi: 8 },
        { t: '2026-04-10T10:00:00Z', avg_dps: 10.2, avg_spi: 8.5 },
      ],
      avg_dps: 9.85,
      avg_spi: 8.25,
      delta_dps: 0.4,
      delta_spi: 0.2,
    },
    series: [],
    efficiency_series: [],
    stats_version: 1,
  }
}

function setupFetch(custom?: (url: string) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (custom) {
      const r = custom(url)
      if (r) return r
    }
    if (url.includes('/api/v1/active-rower')) {
      return new Response(JSON.stringify({ id: 'R1', name: 'D', color: '#0f0', created_at: '' }), {
        status: 200,
      })
    }
    if (url.includes('/api/v1/rowers/R1/trends')) {
      const u = new URL(url, 'http://x')
      const range = (u.searchParams.get('range') ?? 'month') as TrendsRange
      return new Response(JSON.stringify(trendsBody({ range })), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function wrap(initialPath = '/historie/trends') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/historie/trends" element={<TrendsTab />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TrendsTab', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders all 4 sections with mocked trends data', async () => {
    setupFetch()
    wrap()
    await waitFor(() => expect(screen.getByText('Diesen Monat')).toBeInTheDocument())
    expect(screen.getByRole('tablist', { name: 'Zeitraum' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Zusammenfassung' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Leistung' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Effizienz' })).toBeInTheDocument()
  })

  it('switches the trends query when the user picks a different range', async () => {
    const fetchFn = setupFetch()
    wrap()
    await waitFor(() => expect(screen.getByText('Diesen Monat')).toBeInTheDocument())
    const tablist = screen.getByRole('tablist', { name: 'Zeitraum' })
    await userEvent.click(within(tablist).getByRole('tab', { name: 'Woche' }))
    await waitFor(() => {
      const calls = fetchFn.mock.calls.map((c) => String(c[0]))
      expect(calls.some((u) => u.includes('range=week'))).toBe(true)
    })
  })

  it('keeps showing charts when current period has zero sessions but earlier chart points exist', async () => {
    setupFetch((url) => {
      if (url.includes('/api/v1/rowers/R1/trends')) {
        return new Response(JSON.stringify(trendsBody({ sessions: 0 })), { status: 200 })
      }
      return null as unknown as Response
    })
    wrap()
    // Period card stays visible (now shows 0 sessions honestly) and
    // the chart sections still render off the prior-month points.
    await waitFor(() => expect(screen.getByText('Diesen Monat')).toBeInTheDocument())
    expect(screen.queryByTestId('trends-empty')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Leistung' })).toBeInTheDocument()
  })

  it('shows the empty placeholder only when totals AND chart points are empty', async () => {
    setupFetch((url) => {
      if (url.includes('/api/v1/rowers/R1/trends')) {
        const body = trendsBody({ sessions: 0 })
        body.performance.points = []
        body.efficiency.points = []
        return new Response(JSON.stringify(body), { status: 200 })
      }
      return null as unknown as Response
    })
    wrap()
    await waitFor(() => expect(screen.getByTestId('trends-empty')).toBeInTheDocument())
  })
})

describe('TrendsTab series threshold (ADR-0015)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('hides Leistung when no series has ≥3 completed sessions', async () => {
    setupFetch((url) => {
      if (url.includes('/api/v1/rowers/R1/trends')) {
        const body = trendsBody()
        body.series = [
          {
            key: { shape_hash: 'H' },
            params: { meters: 5000 },
            display_name: '5 k',
            points: [
              { t: '2026-05-09T08:35:00Z', session_id: 's1', total_distance_m: 5000, total_time_sec: 1100, avg_power_w: 374, avg_pace_sec_per_500m: 110, avg_dps: 9.6, avg_spi: 12, avg_spm: 28 },
              { t: '2026-05-15T09:00:00Z', session_id: 's2', total_distance_m: 5000, total_time_sec: 1080, avg_power_w: 380, avg_pace_sec_per_500m: 108, avg_dps: 9.7, avg_spi: 12, avg_spm: 28 },
            ], // 2 points — below threshold
          },
        ]
        body.efficiency_series = []
        return new Response(JSON.stringify(body), { status: 200 })
      }
      return null as unknown as Response
    })
    wrap()
    expect(await screen.findByTestId('leistung-empty')).toBeInTheDocument()
    expect(screen.getByTestId('effizienz-empty')).toBeInTheDocument()
  })

  it('renders Leistung when at least one series has ≥3 completed sessions', async () => {
    const pts = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        t: `2026-05-${String(9 + i).padStart(2, '0')}T08:35:00Z`,
        session_id: `s${i + 1}`,
        total_distance_m: 5000,
        total_time_sec: 1100 - i,
        avg_power_w: 374 + i,
        avg_pace_sec_per_500m: 110 - i,
        avg_dps: 9.6,
        avg_spi: 12,
        avg_spm: 28,
      }))
    setupFetch((url) => {
      if (url.includes('/api/v1/rowers/R1/trends')) {
        const body = trendsBody()
        body.series = [
          {
            key: { shape_hash: 'H' },
            params: { meters: 5000 },
            display_name: '5 k',
            pb_pace_sec_per_500m: 108.2,
            points: pts(4),
          },
        ]
        body.efficiency_series = [
          {
            key: { shape_hash: 'H' },
            params: { meters: 5000 },
            display_name: '5 k',
            points: pts(4),
          },
        ]
        return new Response(JSON.stringify(body), { status: 200 })
      }
      return null as unknown as Response
    })
    wrap()
    expect(await screen.findAllByTestId('trends-strip-date')).not.toHaveLength(0)
    expect(screen.getAllByTestId('trends-chart-dot').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('leistung-empty')).not.toBeInTheDocument()
  })
})
