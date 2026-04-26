import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { TrendsResponse } from '../../api/client'
import { TrendsHeadlineCard } from './TrendsHeadlineCard'

const base: TrendsResponse = {
  range: 'month',
  period: { label: 'Diesen Monat', from: '', to: '' },
  totals: { distance_m: 12_345, active_sec: 5_400, sessions: 4 },
  prior: { distance_m: 10_000, active_sec: 4_000, sessions: 3 },
  performance: { points: [], avg_power_w: 0, avg_pace_sec_per_500m: 0 },
  efficiency: { points: [], avg_dps: 0, avg_spi: 0, delta_dps: 0, delta_spi: 0 },
  stats_version: 1,
}

describe('TrendsHeadlineCard', () => {
  it('renders the period label, km, duration and session count', () => {
    render(<TrendsHeadlineCard data={base} />)
    expect(screen.getByText('Diesen Monat')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/12\s*km/)
    expect(screen.getByText('Dauer 1:30')).toBeInTheDocument()
    expect(screen.getByText('Sessions 4')).toBeInTheDocument()
  })

  it('shows a delta chip when a non-zero prior exists', () => {
    render(<TrendsHeadlineCard data={base} />)
    expect(screen.getByTestId('headline-delta')).toBeInTheDocument()
  })

  it('hides the delta chip for range=all', () => {
    render(<TrendsHeadlineCard data={{ ...base, range: 'all', prior: undefined }} />)
    expect(screen.queryByTestId('headline-delta')).not.toBeInTheDocument()
  })

  it('hides the delta chip when prior totals are zero', () => {
    render(
      <TrendsHeadlineCard
        data={{ ...base, prior: { distance_m: 0, active_sec: 0, sessions: 0 } }}
      />,
    )
    expect(screen.queryByTestId('headline-delta')).not.toBeInTheDocument()
  })
})
