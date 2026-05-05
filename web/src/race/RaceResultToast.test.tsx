import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { RaceResultToast } from './RaceResultToast'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('RaceResultToast', () => {
  it('renders both gaps when both are non-null', () => {
    render(<RaceResultToast result={{ vsPbSec: -4.2, vsGhostSec: 2.1 }} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/PB/)
    expect(status.textContent).toMatch(/-4\.2/)
    expect(status.textContent).toMatch(/Ghost/)
    expect(status.textContent).toMatch(/\+2\.1/)
  })

  it('renders only PB segment when ghost is null', () => {
    render(<RaceResultToast result={{ vsPbSec: -1.5, vsGhostSec: null }} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/PB/)
    expect(status.textContent).toMatch(/-1\.5/)
    expect(status.textContent).not.toMatch(/Ghost/)
  })

  it('renders only Ghost segment when PB is null', () => {
    render(<RaceResultToast result={{ vsPbSec: null, vsGhostSec: 3.0 }} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/Ghost/)
    expect(status.textContent).toMatch(/\+3\.0/)
    expect(status.textContent).not.toMatch(/PB/)
  })

  it('renders nothing when result is null', () => {
    const { container } = render(<RaceResultToast result={null} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders 0.0 for a tie', () => {
    render(<RaceResultToast result={{ vsPbSec: 0, vsGhostSec: null }} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/0\.0/)
  })

  it('disappears after 6000ms', () => {
    render(<RaceResultToast result={{ vsPbSec: -1.0, vsGhostSec: null }} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(6001)
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
