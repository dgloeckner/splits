import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TrendsResponse } from '../../api/client'
import { setErgoStatus, _resetErgoStatusForTest } from '../../offline/ergoStatus'
import { VerlaufTab } from './VerlaufTab'

const trends: TrendsResponse = {
  window: '30d',
  from: '2026-05-13T00:00:00Z',
  to: '2026-06-12T00:00:00Z',
  totals: { distance_m: 12000, active_sec: 5400, sessions: 3 },
  prior: { distance_m: 10000, active_sec: 4800, sessions: 2 },
  stats_version: 1,
  points: [
    { t: '2026-06-10T08:00:00Z', session_id: 's3', mode: 'distance', shape_hash: 'H5K',
      distance_m: 5000, time_sec: 1150, avg_pace_sec_per_500m: 115, avg_power_w: 210,
      avg_spm: 22, avg_dps: 9.4, completed: true, distance_pb: true },
    { t: '2026-06-01T08:00:00Z', session_id: 's2', mode: 'distance', shape_hash: 'H5K',
      distance_m: 5000, time_sec: 1170, avg_pace_sec_per_500m: 117, avg_power_w: 200,
      avg_spm: 21, avg_dps: 9.1, completed: true, distance_pb: false },
    { t: '2026-05-20T08:00:00Z', session_id: 's1', mode: 'just_row', shape_hash: undefined,
      distance_m: 2000, time_sec: 600, avg_pace_sec_per_500m: 150, avg_power_w: 120,
      avg_spm: 18, avg_dps: 8.0, completed: false, distance_pb: false },
  ],
  series: [{
    key: { shape_hash: 'H5K' }, params: { meters: 5000 }, display_name: '5 k',
    pb_pace_sec_per_500m: 112,
    points: [
      { t: '2026-06-01T08:00:00Z', session_id: 's2', total_distance_m: 5000, total_time_sec: 1170,
        avg_power_w: 200, avg_pace_sec_per_500m: 117, avg_dps: 9.1, avg_spm: 21 },
      { t: '2026-06-10T08:00:00Z', session_id: 's3', total_distance_m: 5000, total_time_sec: 1150,
        avg_power_w: 210, avg_pace_sec_per_500m: 115, avg_dps: 9.4, avg_spm: 22 },
    ],
  }],
}

vi.mock('../../hooks/useActiveRower', () => ({
  useActiveRower: () => ({ data: { id: 'R1', name: 'T' } }),
}))
vi.mock('../../api/client', async (orig) => ({
  ...(await orig()),
  getRowerTrends: vi.fn(async () => trends),
}))

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/historie']}>
        <VerlaufTab />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('VerlaufTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetErgoStatusForTest()
  })

  it('renders every point as a list row, newest first', async () => {
    mount()
    const rows = await screen.findAllByTestId(/^verlauf-row-/)
    expect(rows).toHaveLength(3)
    expect(rows[0].dataset.testid).toBe('verlauf-row-s3')
  })

  it('🏆 badge only on the standard-distance-PB row', async () => {
    mount()
    expect(await screen.findByTestId('verlauf-pb-s3')).toBeInTheDocument()
    expect(screen.queryByTestId('verlauf-pb-s2')).toBeNull()
    expect(screen.queryByTestId('verlauf-pb-s1')).toBeNull()
  })

  it('volume footnote uses real units and the fair delta', async () => {
    mount()
    const note = await screen.findByTestId('verlauf-footnote')
    expect(note.textContent).toContain('12')
    expect(note.textContent).toContain('3')
    expect(note.textContent).toContain('+20')
  })

  it('metric toggle switches the chart series', async () => {
    mount()
    await screen.findByTestId('progress-strip')
    fireEvent.click(screen.getByRole('tab', { name: 'Watt' }))
    expect(screen.getByTestId('progress-strip').textContent).toContain('210')
  })

  it('chart context dots cover non-series sessions', async () => {
    mount()
    expect(await screen.findAllByTestId('progress-context-dot')).toHaveLength(1)
    expect(screen.getAllByTestId('progress-line-dot')).toHaveLength(2)
  })

  // Issue #9 (option B): the in-memory bag is not the only offline store
  // — the SW cache holds the packed details too — so no row is dimmed;
  // the detail page explains a miss instead.
  it('unreachable: every row stays a link, cached in the bag or not', async () => {
    _resetErgoStatusForTest()
    setErgoStatus({ reachable: false, packedAt: '2026-06-12T10:00:00' })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['sessions', 's3'], { id: 's3' })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/historie']}>
          <VerlaufTab />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const cached = await screen.findByTestId('verlauf-row-s3')
    expect(cached.tagName).toBe('A')
    const notInBag = screen.getByTestId('verlauf-row-s2')
    expect(notInBag.tagName).toBe('A')
    expect(notInBag).toHaveAttribute('href', '/historie/s2')
    expect(notInBag).not.toHaveAttribute('aria-disabled')
  })

  it('unreachable with restored data: no error placeholder', async () => {
    _resetErgoStatusForTest()
    setErgoStatus({ reachable: false })
    mount()
    // data is present from mock, error placeholder should not appear
    await screen.findByTestId('verlauf-row-s3')
    expect(screen.queryByText('Konnte Verlauf nicht laden.')).toBeNull()
  })
})
