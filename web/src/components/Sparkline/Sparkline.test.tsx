import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Sparkline } from './Sparkline'

describe('Sparkline', () => {
  it('renders an empty state (no path) when points are empty', () => {
    const { container } = render(<Sparkline points={[]} />)
    expect(container.querySelectorAll('path').length).toBe(0)
  })

  it('renders a path when given at least two points', () => {
    const { container } = render(
      <Sparkline
        points={[
          { time_sec: 0, value: 100 },
          { time_sec: 30, value: 200 },
          { time_sec: 60, value: 150 },
        ]}
      />,
    )
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('renders a single dot when given exactly one point', () => {
    const { container } = render(<Sparkline points={[{ time_sec: 0, value: 100 }]} />)
    expect(container.querySelector('circle')).not.toBeNull()
  })
})
