import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { FALSCHSTART_TOAST_MS, FalschstartToast } from './FalschstartToast'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('FalschstartToast', () => {
  it('renders nothing while triggeredAtMs is null', () => {
    const { container } = render(<FalschstartToast triggeredAtMs={null} />)
    expect(container.querySelector('[data-testid="falschstart-toast"]')).toBeNull()
  })

  it('first non-null triggeredAtMs renders the toast', () => {
    const { container } = render(<FalschstartToast triggeredAtMs={100} />)
    expect(container.querySelector('[data-testid="falschstart-toast"]')).not.toBeNull()
  })

  it('auto-dismisses after FALSCHSTART_TOAST_MS', () => {
    const { container } = render(<FalschstartToast triggeredAtMs={100} />)
    expect(container.querySelector('[data-testid="falschstart-toast"]')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(FALSCHSTART_TOAST_MS - 1)
    })
    expect(container.querySelector('[data-testid="falschstart-toast"]')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.querySelector('[data-testid="falschstart-toast"]')).toBeNull()
  })

  it('stays visible across prop changes that flip back to null mid-display', () => {
    // Simulates the fast-fixture race: reducer transitions through
    // Live(Falschstart) → Finished → Post within a single render
    // frame, so the parent may briefly read state.falschstartShownAtMs
    // back to null (e.g. on a remount). The toast must NOT
    // re-evaluate visibility from the prop; only the internal timer
    // can dismiss it.
    const { container, rerender } = render(<FalschstartToast triggeredAtMs={100} />)
    expect(container.querySelector('[data-testid="falschstart-toast"]')).not.toBeNull()
    // Halfway through the display window, prop flips to null. Toast
    // must remain visible.
    act(() => {
      vi.advanceTimersByTime(FALSCHSTART_TOAST_MS / 2)
    })
    rerender(<FalschstartToast triggeredAtMs={null} />)
    expect(container.querySelector('[data-testid="falschstart-toast"]')).not.toBeNull()
    // Timer still fires at the full duration.
    act(() => {
      vi.advanceTimersByTime(FALSCHSTART_TOAST_MS / 2)
    })
    expect(container.querySelector('[data-testid="falschstart-toast"]')).toBeNull()
  })

  it('repeating the same triggeredAtMs value does not re-trigger the timer', () => {
    const { container, rerender } = render(<FalschstartToast triggeredAtMs={100} />)
    act(() => {
      vi.advanceTimersByTime(FALSCHSTART_TOAST_MS - 100)
    })
    // Same value re-emitted while the timer is still ticking.
    rerender(<FalschstartToast triggeredAtMs={100} />)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    // Toast dismissed at the original deadline, not extended by the
    // duplicate prop emission.
    expect(container.querySelector('[data-testid="falschstart-toast"]')).toBeNull()
  })
})
