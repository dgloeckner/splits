import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrendsChart, type TrendsChartSeries } from './TrendsChart'

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-05-09T08:35:00+02:00').getTime()

function fixtureSeries(): TrendsChartSeries[] {
  return [
    {
      key: 'H_5K',
      label: '5 k',
      tone: 'primary',
      variant: 'solid',
      fmt: (v) => v.toFixed(0),
      points: [
        { t: T0, y: 110, sessionId: 's1' },
        { t: T0 + 6 * DAY, y: 109, sessionId: 's2' },
        { t: T0 + 8 * DAY, y: 107, sessionId: 's3' },
        { t: T0 + 14 * DAY, y: 107, sessionId: 's4' },
      ],
    },
  ]
}

describe('TrendsChart', () => {
  it('renders one dot per point and 3 gridlines', () => {
    render(
      <TrendsChart
        series={fixtureSeries()}
        range="month"
        rollingFor="primary-only"
        onDotTap={() => {}}
      />,
    )
    expect(screen.getAllByTestId('trends-chart-dot')).toHaveLength(4)
    expect(screen.getAllByTestId('trends-chart-gridline')).toHaveLength(3)
  })

  it('renders the rolling-avg path when rollingFor="primary-only" and window non-null', () => {
    render(
      <TrendsChart
        series={fixtureSeries()}
        range="month"
        rollingFor="primary-only"
        onDotTap={() => {}}
      />,
    )
    expect(screen.getByTestId('trends-chart-rolling')).toBeInTheDocument()
  })

  it('omits rolling-avg when rollingFor="none"', () => {
    render(
      <TrendsChart
        series={fixtureSeries()}
        range="month"
        rollingFor="none"
        onDotTap={() => {}}
      />,
    )
    expect(screen.queryByTestId('trends-chart-rolling')).not.toBeInTheDocument()
  })

  it('omits rolling-avg on Wochen (null window) even with rollingFor="primary-only"', () => {
    render(
      <TrendsChart
        series={fixtureSeries()}
        range="week"
        rollingFor="primary-only"
        onDotTap={() => {}}
      />,
    )
    expect(screen.queryByTestId('trends-chart-rolling')).not.toBeInTheDocument()
  })

  it('strip shows the latest dot in idle state', () => {
    render(
      <TrendsChart
        series={fixtureSeries()}
        range="month"
        rollingFor="primary-only"
        onDotTap={() => {}}
      />,
    )
    // Latest point: T0 + 14 days. T0 was 2026-05-09 (Saturday). +14 days = 2026-05-23 (Saturday).
    expect(screen.getByTestId('trends-strip-date')).toHaveTextContent('23. Mai · Samstag')
    expect(screen.getByTestId('trends-strip-row-H_5K')).toHaveTextContent('5 k')
    expect(screen.getByTestId('trends-strip-row-H_5K')).toHaveTextContent('107')
  })
})
