import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RaceCanvas } from './RaceCanvas'

const ghost = { kind: 'session' as const, sourceSessionId: 'g', label: 'ghost' as const,
  tSec: [0, 60, 120, 180, 240], split: [120, 120, 120, 120, 120] }
const pb = { ...ghost, sourceSessionId: 'p', label: 'pb' as const, split: [110, 110, 110, 110, 110] }

describe('RaceCanvas', () => {
  it('3 lanes with both opponents', () => {
    const { container } = render(<RaceCanvas
      elapsedSec={60} userDistanceM={250} totalMeters={2000}
      ghost={ghost} pb={pb} viewportWidth={1024} viewportHeight={500} reducedMotion={false} />)
    expect(container.querySelectorAll('[data-lane]')).toHaveLength(3)
  })

  it('ghost-only → 2 lanes', () => {
    const { container } = render(<RaceCanvas
      elapsedSec={60} userDistanceM={250} totalMeters={2000}
      ghost={ghost} pb={null} viewportWidth={400} viewportHeight={300} reducedMotion={false} />)
    expect(container.querySelectorAll('[data-lane]')).toHaveLength(2)
  })

  it('renders distance markers on tablet (>=768px)', () => {
    // At 4px/m and viewport 1024 the visible band around the user is ±128m,
    // which fits 2 markers at the 100m step. The relevant assertion is that
    // tablet renders some markers (vs phone which renders none).
    const { container } = render(<RaceCanvas
      elapsedSec={60} userDistanceM={250} totalMeters={2000}
      ghost={ghost} pb={null} viewportWidth={1024} viewportHeight={300} reducedMotion={false} />)
    expect(container.querySelectorAll('[data-marker]').length).toBeGreaterThan(0)
  })

  it('omits markers on narrow phone', () => {
    const { container } = render(<RaceCanvas
      elapsedSec={60} userDistanceM={250} totalMeters={2000}
      ghost={ghost} pb={null} viewportWidth={320} viewportHeight={300} reducedMotion={false} />)
    expect(container.querySelectorAll('[data-marker]').length).toBe(0)
  })

  it('reduced-motion disables water animation flag', () => {
    const { container } = render(<RaceCanvas
      elapsedSec={60} userDistanceM={250} totalMeters={2000}
      ghost={ghost} pb={null} viewportWidth={1024} viewportHeight={300} reducedMotion={true} />)
    expect(container.querySelector('[data-water-animated="true"]')).toBeNull()
  })

  it('renders finish flag on tablet when in view', () => {
    const { container } = render(<RaceCanvas
      elapsedSec={60} userDistanceM={1900} totalMeters={2000}
      ghost={ghost} pb={null} viewportWidth={1024} viewportHeight={300} reducedMotion={false} />)
    expect(container.querySelector('[data-finish="flag"]')).not.toBeNull()
  })

  it('shows pace trails (3 segments per opponent)', () => {
    const { container } = render(<RaceCanvas
      elapsedSec={60} userDistanceM={250} totalMeters={2000}
      ghost={ghost} pb={null} viewportWidth={1024} viewportHeight={300} reducedMotion={false} />)
    expect(container.querySelectorAll('[data-trail]').length).toBe(3)
  })
})
