import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { DualLineChart, type Series } from './DualLineChart'

const primary: Series = {
  label: 'P',
  variant: 'solid',
  tone: 'primary',
  points: [
    { x: 1, y: 100 },
    { x: 2, y: 110 },
    { x: 3, y: 105 },
  ],
}
const secondary: Series = {
  label: 'S',
  variant: 'dashed',
  tone: 'neutral',
  points: [
    { x: 1, y: 130 },
    { x: 2, y: 128 },
    { x: 3, y: 126 },
  ],
}

describe('DualLineChart', () => {
  it('renders both paths when both series have points', () => {
    render(<DualLineChart primary={primary} secondary={secondary} />)
    expect(screen.getByTestId('dlc-primary')).toBeInTheDocument()
    expect(screen.getByTestId('dlc-secondary')).toBeInTheDocument()
  })

  it('omits the secondary path when only primary is given', () => {
    render(<DualLineChart primary={primary} />)
    expect(screen.getByTestId('dlc-primary')).toBeInTheDocument()
    expect(screen.queryByTestId('dlc-secondary')).not.toBeInTheDocument()
  })

  it('renders the empty placeholder when no series has any points', () => {
    render(
      <DualLineChart
        primary={{ ...primary, points: [] }}
        secondary={{ ...secondary, points: [] }}
      />,
    )
    expect(screen.getByTestId('dlc-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('dlc-primary')).not.toBeInTheDocument()
  })
})
