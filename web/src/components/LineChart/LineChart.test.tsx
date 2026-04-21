import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LineChart } from './LineChart'

describe('LineChart', () => {
  it('renders title + an SVG path when data has ≥ 2 points', () => {
    const { container } = render(
      <LineChart
        title="Watt"
        points={[
          { x: 0, y: 200 },
          { x: 10, y: 210 },
          { x: 20, y: 195 },
        ]}
      />,
    )
    expect(container.querySelector('path')).not.toBeNull()
    expect(container.textContent).toContain('Watt')
  })

  it('renders empty state when points are empty', () => {
    const { container } = render(<LineChart title="Watt" points={[]} />)
    expect(container.querySelectorAll('path').length).toBe(0)
    expect(container.textContent).toContain('Keine Daten')
  })

  it('renders a dot when only one point is given', () => {
    const { container } = render(<LineChart title="Watt" points={[{ x: 0, y: 42 }]} />)
    expect(container.querySelector('circle')).not.toBeNull()
  })
})
