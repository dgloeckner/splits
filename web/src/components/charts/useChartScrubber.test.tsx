import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChartScrubber } from './useChartScrubber'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function pointerEvent(
  type: string,
  clientX: number,
  clientY: number,
): React.PointerEvent<SVGRectElement> {
  return {
    type,
    clientX,
    clientY,
    pointerId: 1,
    preventDefault: () => {},
    currentTarget: {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
    },
  } as unknown as React.PointerEvent<SVGRectElement>
}

function makeArgs(overrides: Partial<Parameters<typeof useChartScrubber>[0]> = {}) {
  const onDotTap = vi.fn()
  return {
    args: {
      getPlotRect: () =>
        ({
          left: 0,
          top: 0,
          right: 300,
          bottom: 160,
          width: 300,
          height: 160,
          x: 0,
          y: 0,
        }) as DOMRect,
      dots: [
        { x: 0, sessionId: 's0' },
        { x: 100, sessionId: 's1' },
        { x: 200, sessionId: 's2' },
        { x: 300, sessionId: 's3' },
      ],
      onDotTap,
      ...overrides,
    },
    onDotTap,
  }
}

describe('useChartScrubber', () => {
  it('starts idle with scrubX === null', () => {
    const { args } = makeArgs()
    const { result } = renderHook(() => useChartScrubber(args))
    expect(result.current.scrubX).toBeNull()
  })

  it('advances scrubX past the drag threshold', () => {
    const { args } = makeArgs()
    const { result } = renderHook(() => useChartScrubber(args))

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent('pointerdown', 50, 80))
      result.current.handlers.onPointerMove(pointerEvent('pointermove', 70, 80))
    })

    // Snaps to nearest dot's x. From x=70, nearest is dot at x=100.
    expect(result.current.scrubX).toBe(100)
  })

  it('does NOT advance scrubX when movement is below threshold', () => {
    const { args } = makeArgs()
    const { result } = renderHook(() => useChartScrubber(args))

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent('pointerdown', 50, 80))
      result.current.handlers.onPointerMove(pointerEvent('pointermove', 55, 80))
    })

    expect(result.current.scrubX).toBeNull()
  })

  it('fires onDotTap when pointerup within 200 ms and 10 px of a dot', () => {
    const { args, onDotTap } = makeArgs()
    const { result } = renderHook(() => useChartScrubber(args))

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent('pointerdown', 102, 80))
      vi.advanceTimersByTime(50)
      result.current.handlers.onPointerUp(pointerEvent('pointerup', 102, 80))
    })

    expect(onDotTap).toHaveBeenCalledWith('s1')
    expect(result.current.scrubX).toBeNull()
  })

  it('does NOT fire onDotTap on a tap far from any dot', () => {
    const { args, onDotTap } = makeArgs()
    const { result } = renderHook(() => useChartScrubber(args))

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent('pointerdown', 50, 80))
      vi.advanceTimersByTime(50)
      result.current.handlers.onPointerUp(pointerEvent('pointerup', 50, 80))
    })

    expect(onDotTap).not.toHaveBeenCalled()
    expect(result.current.scrubX).toBeNull()
  })

  it('does NOT fire onDotTap if the pointer drifted past 10 px', () => {
    const { args, onDotTap } = makeArgs()
    const { result } = renderHook(() => useChartScrubber(args))

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent('pointerdown', 100, 80))
      result.current.handlers.onPointerMove(pointerEvent('pointermove', 115, 80))
      result.current.handlers.onPointerUp(pointerEvent('pointerup', 115, 80))
    })

    expect(onDotTap).not.toHaveBeenCalled()
  })

  it('clears scrubX 3000 ms after pointerup post-scrub', () => {
    const { args } = makeArgs()
    const { result } = renderHook(() => useChartScrubber(args))

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent('pointerdown', 50, 80))
      result.current.handlers.onPointerMove(pointerEvent('pointermove', 105, 80))
      result.current.handlers.onPointerUp(pointerEvent('pointerup', 105, 80))
    })
    expect(result.current.scrubX).toBe(100)

    act(() => {
      vi.advanceTimersByTime(2999)
    })
    expect(result.current.scrubX).toBe(100)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.scrubX).toBeNull()
  })

  it('treats pointercancel like pointerup', () => {
    const { args } = makeArgs()
    const { result } = renderHook(() => useChartScrubber(args))

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent('pointerdown', 50, 80))
      result.current.handlers.onPointerMove(pointerEvent('pointermove', 105, 80))
      result.current.handlers.onPointerCancel(pointerEvent('pointercancel', 105, 80))
      vi.advanceTimersByTime(3000)
    })

    expect(result.current.scrubX).toBeNull()
  })
})
