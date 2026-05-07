import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PaceOverlayChart } from './PaceOverlayChart'

describe('PaceOverlayChart', () => {
  it('renders one polyline per series', () => {
    const series = [
      { color: '#14B8A6', label: 'You', tSec: [0, 60, 120], split: [120, 118, 116] },
      { color: '#94A3B8', label: 'Ghost', tSec: [0, 60, 120], split: [125, 124, 123] },
    ]
    const { container } = render(
      <PaceOverlayChart series={series} totalMeters={500} width={400} height={200} />,
    )
    expect(container.querySelectorAll('polyline').length).toBe(2)
  })

  it('renders axis lines and a11y label', () => {
    const series = [{ color: '#14B8A6', label: 'You', tSec: [0, 60], split: [120, 118] }]
    const { container, getByRole } = render(
      <PaceOverlayChart series={series} totalMeters={250} width={200} height={120} />,
    )
    expect(getByRole('img').getAttribute('aria-label')).toMatch(/Pace/i)
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(2)
  })

  it('handles a single point per series without crashing', () => {
    const series = [{ color: '#14B8A6', label: 'You', tSec: [0], split: [120] }]
    const { container } = render(
      <PaceOverlayChart series={series} totalMeters={500} width={300} height={150} />,
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
