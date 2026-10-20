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

  // A 1:48 body with a 2:45 start bucket, as on the 11.06.2026 session.
  const spike = [{ x: 0, y: 165 }, ...Array.from({ length: 60 }, (_, i) => ({ x: (i + 1) * 10, y: 105 + (i % 6) }))]
  const tickLabels = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('text')).map((t) => t.textContent ?? '').filter((t) => /^\d+$/.test(t)).map(Number)

  it('with a window the y-domain is the working range inside it', () => {
    const { container } = render(<SessionChart title="Split" points={spike} metric="split"
      fmt={(v) => `${v}`} focus={{ fromX: 10, toX: 600 }} />)
    const ys = tickLabels(container)
    expect(Math.max(...ys)).toBeLessThanOrEqual(115)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(100)
  })

  it('without a window the y-domain is the trimmed range', () => {
    const { container } = render(<SessionChart title="Split" points={spike} metric="split" fmt={(v) => `${v}`} />)
    expect(Math.max(...tickLabels(container))).toBeLessThanOrEqual(115)
  })

  it('clips points outside the domain to the plot edge and keeps the path continuous', () => {
    const { container } = render(<SessionChart title="Split" points={spike} metric="split"
      fmt={(v) => `${v}`} focus={{ fromX: 10, toX: 600 }} />)
    const d = container.querySelector('path')!.getAttribute('d')!
    expect(d.startsWith('M 34.00 6.00')).toBe(true) // first point pinned to the top edge (TOP_PAD)
    expect(d.match(/C /g)).toHaveLength(spike.length - 1)
  })
})
