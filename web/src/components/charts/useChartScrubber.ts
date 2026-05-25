import { useCallback, useEffect, useRef, useState } from 'react'

const DRAG_THRESHOLD_PX = 10
const TAP_TIMEOUT_MS = 200
const DOT_TAP_RADIUS_PX = 10
const RELEASE_HOLD_MS = 3000

export type ChartDot = { x: number; sessionId: string }

export type UseChartScrubberArgs = {
  getPlotRect: () => DOMRect | null
  dots: ChartDot[]
  onDotTap: (sessionId: string) => void
}

export type UseChartScrubberResult = {
  scrubX: number | null
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
}

type GestureState =
  | { kind: 'idle' }
  | { kind: 'armed'; startX: number; startY: number; startTime: number }
  | { kind: 'scrubbing' }
  | { kind: 'released' }

export function useChartScrubber(args: UseChartScrubberArgs): UseChartScrubberResult {
  const [scrubX, setScrubX] = useState<number | null>(null)
  const stateRef = useRef<GestureState>({ kind: 'idle' })
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current)
    }
  }, [])

  const localX = useCallback(
    (clientX: number) => {
      const rect = args.getPlotRect()
      return rect ? clientX - rect.left : clientX
    },
    [args],
  )

  const snapToNearestDot = useCallback(
    (x: number): number | null => {
      if (args.dots.length === 0) return null
      let bestX = args.dots[0].x
      let bestDist = Math.abs(args.dots[0].x - x)
      for (const d of args.dots) {
        const dist = Math.abs(d.x - x)
        if (dist < bestDist) {
          bestX = d.x
          bestDist = dist
        }
      }
      return bestX
    },
    [args],
  )

  const findDotNear = useCallback(
    (x: number): ChartDot | null => {
      for (const d of args.dots) {
        if (Math.abs(d.x - x) <= DOT_TAP_RADIUS_PX) return d
      }
      return null
    },
    [args],
  )

  const clearRelease = useCallback(() => {
    if (releaseTimer.current) {
      clearTimeout(releaseTimer.current)
      releaseTimer.current = null
    }
  }, [])

  const reset = useCallback(() => {
    stateRef.current = { kind: 'idle' }
    setScrubX(null)
    clearRelease()
  }, [clearRelease])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      clearRelease()
      stateRef.current = {
        kind: 'armed',
        startX: localX(e.clientX),
        startY: e.clientY,
        startTime: Date.now(),
      }
    },
    [clearRelease, localX],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = stateRef.current
      const x = localX(e.clientX)
      if (s.kind === 'armed') {
        const dx = Math.abs(x - s.startX)
        const dy = Math.abs(e.clientY - s.startY)
        if (Math.max(dx, dy) >= DRAG_THRESHOLD_PX) {
          stateRef.current = { kind: 'scrubbing' }
          setScrubX(snapToNearestDot(x))
        }
      } else if (s.kind === 'scrubbing') {
        setScrubX(snapToNearestDot(x))
      }
    },
    [localX, snapToNearestDot],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const s = stateRef.current
      const x = localX(e.clientX)
      if (s.kind === 'armed') {
        const dt = Date.now() - s.startTime
        const dx = Math.abs(x - s.startX)
        if (dt < TAP_TIMEOUT_MS && dx < DRAG_THRESHOLD_PX) {
          const dot = findDotNear(x)
          if (dot) {
            args.onDotTap(dot.sessionId)
          }
        }
        reset()
      } else if (s.kind === 'scrubbing') {
        stateRef.current = { kind: 'released' }
        clearRelease()
        releaseTimer.current = setTimeout(() => {
          stateRef.current = { kind: 'idle' }
          setScrubX(null)
          releaseTimer.current = null
        }, RELEASE_HOLD_MS)
      }
    },
    [args, clearRelease, findDotNear, localX, reset],
  )

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      onPointerUp(e)
    },
    [onPointerUp],
  )

  return {
    scrubX,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  }
}
