import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TargetDot } from './TargetDot'

describe('TargetDot', () => {
  it('renders nothing when status is none', () => {
    const { container } = render(<TargetDot status="none" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders in-range dot with in class', () => {
    render(<TargetDot status="in" />)
    const dot = screen.getByTestId('target-dot')
    expect(dot.getAttribute('data-status')).toBe('in')
    expect(dot.className).toMatch(/_in_/)
  })

  it.each(['under', 'over'] as const)('renders out-of-range dot for %s', (status) => {
    render(<TargetDot status={status} />)
    const dot = screen.getByTestId('target-dot')
    expect(dot.className).toMatch(/_out_/)
    expect(dot.getAttribute('data-status')).toBe(status)
  })
})
