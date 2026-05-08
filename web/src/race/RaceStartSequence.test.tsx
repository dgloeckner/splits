import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RaceStartSequence } from './RaceStartSequence'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('RaceStartSequence', () => {
  it('renders nothing when disabled', () => {
    const { container } = render(<RaceStartSequence enabled={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows ATTENTION at 0ms with red dot active', () => {
    const { getByText, container } = render(<RaceStartSequence enabled />)
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(getByText('ATTENTION')).toBeTruthy()
    expect(container.querySelector('[data-color="red"][data-active="true"]')).not.toBeNull()
    expect(container.querySelector('[data-color="amber"][data-active="true"]')).toBeNull()
  })

  it('advances to SET at 1500ms with amber active', () => {
    const { getByText, container } = render(<RaceStartSequence enabled />)
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(getByText('SET')).toBeTruthy()
    expect(container.querySelector('[data-color="amber"][data-active="true"]')).not.toBeNull()
    expect(container.querySelector('[data-color="red"][data-active="true"]')).toBeNull()
  })

  it('shows GO! at 3000ms with green active', () => {
    const { getByText, container } = render(<RaceStartSequence enabled />)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(getByText('GO!')).toBeTruthy()
    expect(container.querySelector('[data-color="green"][data-active="true"]')).not.toBeNull()
  })

  it('hides at 4500ms and calls onComplete', () => {
    const onComplete = vi.fn()
    const { container } = render(<RaceStartSequence enabled onComplete={onComplete} />)
    act(() => {
      vi.advanceTimersByTime(4500)
    })
    expect(container.firstChild).toBeNull()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('clears timers on unmount', () => {
    const onComplete = vi.fn()
    const { unmount } = render(<RaceStartSequence enabled onComplete={onComplete} />)
    unmount()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(onComplete).not.toHaveBeenCalled()
  })
})
