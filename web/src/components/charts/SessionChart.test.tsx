import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SessionChart } from './SessionChart'

describe('SessionChart', () => {
  const pts = Array.from({ length: 40 }, (_, i) => ({ x: i * 30, y: 200 + (i % 5) * 4 }))
  it('renders the direct-labeled session average', () => {
    render(<SessionChart title="Watt-Verlauf" points={pts} metric="watt" fmt={(v) => `${v}`} avgValue={208} />)
    expect(screen.getByTestId('session-chart-avg')).toBeInTheDocument()
    expect(screen.getByText('Ø 208')).toBeInTheDocument()
  })
  it('x-axis ticks are round time boundaries', () => {
    render(<SessionChart title="Watt-Verlauf" points={pts} metric="watt" fmt={(v) => `${v}`} />)
    // 1170 s span → 300 s steps: 0:00, 5:00, 10:00, 15:00
    expect(screen.getByText('5:00')).toBeInTheDocument()
  })
})
