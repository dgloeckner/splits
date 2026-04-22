import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Sparkline } from './Sparkline'

describe('Sparkline', () => {
  it('shows "sammle Daten…" placeholder when points are empty', () => {
    const { container } = render(<Sparkline points={[]} />)
    expect(container.textContent).toContain('sammle Daten')
    expect(container.querySelectorAll('path').length).toBe(0)
  })

  it('shows the placeholder when only one point is available', () => {
    const { container } = render(<Sparkline points={[{ time_sec: 0, value: 100 }]} />)
    expect(container.textContent).toContain('sammle Daten')
  })

  it('renders a monotone-cubic path when given at least two points', () => {
    const { container } = render(
      <Sparkline
        points={[
          { time_sec: 0, value: 100 },
          { time_sec: 30, value: 200 },
          { time_sec: 60, value: 150 },
        ]}
      />,
    )
    const line = container.querySelector('path[class*="line"]')
    expect(line).not.toBeNull()
    // Monotone cubic uses "C" (cubic-bezier) segments, not plain "L".
    expect(line!.getAttribute('d')).toMatch(/C/)
  })

  it('renders a dashed reference line when data is present', () => {
    const { container } = render(
      <Sparkline
        points={[
          { time_sec: 0, value: 100 },
          { time_sec: 30, value: 200 },
        ]}
      />,
    )
    // The first path is the reference line (.ref class module-scoped).
    const refPath = container.querySelector('path[class*="ref"]')
    expect(refPath).not.toBeNull()
  })

  it('uses externally provided yMin/yMax for vertical mapping', () => {
    // With a fixed axis of [0, 400], a value of 200 should map to the midpoint
    // of the 40-unit tall viewbox (y=20). We check that the line path contains
    // approximately y=20 for the 200-value point.
    const { container } = render(
      <Sparkline
        yMin={0}
        yMax={400}
        points={[
          { time_sec: 0, value: 200 },
          { time_sec: 30, value: 200 },
        ]}
      />,
    )
    const line = container.querySelector('path[class*="line"]')
    // Both points have value=200, so regardless of x they map to y=20 on
    // a [0, 400] axis within a 40-unit tall viewbox.
    expect(line?.getAttribute('d')).toMatch(/20\.00/)
    // And should not map anywhere else.
    expect(line?.getAttribute('d')).not.toMatch(/[13]\d\.\d\d/)
  })

  it('respects a custom windowSeconds prop', () => {
    const { container } = render(
      <Sparkline
        windowSeconds={120}
        points={[
          { time_sec: 0, value: 100 },
          { time_sec: 60, value: 200 },
        ]}
      />,
    )
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
  })
})
