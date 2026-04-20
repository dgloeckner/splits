import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MetricCard } from './MetricCard'

describe('MetricCard', () => {
  it('renders label, value, and unit', () => {
    render(<MetricCard label="Distanz" value="1:54.3" unit="/ 500m" />)
    expect(screen.getByText('Distanz')).toBeInTheDocument()
    expect(screen.getByText('1:54.3')).toBeInTheDocument()
    expect(screen.getByText('/ 500m')).toBeInTheDocument()
  })

  it('renders without unit', () => {
    render(<MetricCard label="SPM" value="27" />)
    expect(screen.getByText('SPM')).toBeInTheDocument()
    expect(screen.getByText('27')).toBeInTheDocument()
  })

  it('renders idle placeholder "—" when value is null', () => {
    render(<MetricCard label="DPS" value={null} unit="m" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it("label uses uppercase via the 'label-sm' class", () => {
    render(<MetricCard label="Watt" value="230" unit="W" />)
    expect(screen.getByText('Watt')).toHaveClass('label-sm')
  })

  it('value uses tabular numerals for consistent digit widths', () => {
    render(<MetricCard label="x" value="1234" />)
    expect(screen.getByText('1234')).toHaveClass('tnum')
  })
})
