import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { BoatSprite } from './BoatSprite'

describe('BoatSprite', () => {
  it('renders full variant with rower head, oar shaft, oar blade, and 2 paths', () => {
    const { container } = render(<BoatSprite />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(container.querySelectorAll('circle')).toHaveLength(1)
    expect(container.querySelectorAll('line')).toHaveLength(1)
    expect(container.querySelectorAll('ellipse')).toHaveLength(1)
    expect(container.querySelectorAll('path')).toHaveLength(2)
  })

  it('renders hull-only variant with just the hull path', () => {
    const { container } = render(<BoatSprite variant="hull" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(container.querySelectorAll('path')).toHaveLength(1)
    expect(container.querySelectorAll('circle')).toHaveLength(0)
    expect(container.querySelectorAll('line')).toHaveLength(0)
    expect(container.querySelectorAll('ellipse')).toHaveLength(0)
  })

  it('uses currentColor for stroke by default', () => {
    const { container } = render(<BoatSprite />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('stroke')).toBe('currentColor')
  })

  it('applies scaleX(-1) transform when flipped', () => {
    const { container } = render(<BoatSprite flipped />)
    const svg = container.querySelector('svg')!
    expect(svg.style.transform).toBe('scaleX(-1)')
  })

  it('does not apply transform when not flipped', () => {
    const { container } = render(<BoatSprite />)
    const svg = container.querySelector('svg')!
    expect(svg.style.transform).toBe('')
  })

  it('renders explicit width="72" and height="24" attributes on the svg (full variant)', () => {
    // Guards against the 0017-01 regression: an SVG without intrinsic
    // dimensions inside an absolutely-positioned wrapper computes 0x0
    // in headless Chromium, so the boat is invisible at ATTENTION.
    const { container } = render(<BoatSprite />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('72')
    expect(svg.getAttribute('height')).toBe('24')
  })

  it('renders explicit width="72" and height="24" attributes on the svg (hull variant)', () => {
    const { container } = render(<BoatSprite variant="hull" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('72')
    expect(svg.getAttribute('height')).toBe('24')
  })
})
