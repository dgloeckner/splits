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
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThan(0)
    // Monotone cubic uses "C" (cubic-bezier) segments, not plain "L".
    expect(paths[0].getAttribute('d')).toMatch(/C/)
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
