import { useEffect, useRef, useState } from 'react'
import type { SparklinePoint } from '../../live/reducer'
import styles from './Sparkline.module.css'

type Props = {
  points: SparklinePoint[]
  /** Optional ghost line at a constant y — used for session-average. */
  ghost?: number
  /** Rolling-window duration in seconds. Defaults to 90 s (phone default). */
  windowSeconds?: number
  /**
   * Optional externally computed Y-axis bounds. When supplied, the path is
   * rendered against these bounds (and may overflow if a peak exceeds them —
   * the tile chrome clips with `overflow: hidden`). When omitted, the axis
   * falls back to the min/max of the current data (legacy behaviour).
   */
  yMin?: number
  yMax?: number
}

const WIDTH = 100
const HEIGHT = 40

/**
 * Fritsch–Carlson monotone cubic: compute one tangent per knot, then emit
 * cubic Bézier segments. Does NOT overshoot recorded peaks.
 * Inspired by the Steffen variant; kept dependency-free (≤40 LOC core).
 */
function monotonePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  const n = pts.length
  const dx: number[] = new Array(n - 1)
  const dy: number[] = new Array(n - 1)
  const m: number[] = new Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    dy[i] = pts[i + 1].y - pts[i].y
    m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i]
  }
  const t: number[] = new Array(n)
  t[0] = m[0]
  t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0
    else t[i] = (m[i - 1] + m[i]) / 2
  }
  // Enforce monotonicity (Fritsch–Carlson).
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
    } else {
      const a = t[i] / m[i]
      const b = t[i + 1] / m[i]
      const h = Math.hypot(a, b)
      if (h > 3) {
        const s = 3 / h
        t[i] = s * a * m[i]
        t[i + 1] = s * b * m[i]
      }
    }
  }
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3
    const y1 = pts[i].y + (t[i] * dx[i]) / 3
    const x2 = pts[i + 1].x - dx[i] / 3
    const y2 = pts[i + 1].y - (t[i + 1] * dx[i]) / 3
    d += ` C ${x1.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} ${pts[i + 1].x.toFixed(2)} ${pts[i + 1].y.toFixed(2)}`
  }
  return d
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
      return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else mq.addListener(handler)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else mq.removeListener(handler)
    }
  }, [])
  return reduced
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  )
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

export function Sparkline({ points, ghost, windowSeconds = 90, yMin, yMax }: Props) {
  const reduced = useReducedMotion()
  const visible = usePageVisible()
  const groupRef = useRef<SVGGElement | null>(null)
  const rafRef = useRef<number | null>(null)

  // Continuous CSS-transform scroll: driven by rAF, resets on new point arrival.
  useEffect(() => {
    const g = groupRef.current
    if (!g) return
    if (reduced || !visible || points.length < 2) {
      g.style.transform = 'translateX(0)'
      return
    }
    const startMs = Date.now()
    const pxPerSec = WIDTH / windowSeconds

    const tick = () => {
      const deltaSec = (Date.now() - startMs) / 1000
      // Scroll leftward (negative translate). Bound by one window width to
      // prevent unbounded growth when frames stall.
      const dx = -Math.min(pxPerSec * deltaSec, WIDTH)
      g.style.transform = `translateX(${dx.toFixed(2)}px)`
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // lastTimeSec is what we really depend on, but points array identity
    // already changes on each new point — either works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, reduced, visible, windowSeconds])

  if (points.length < 2) {
    return <div className={styles.placeholder}>sammle Daten…</div>
  }

  const xs = points.map((p) => p.time_sec)
  const ys = points.map((p) => p.value)
  const xMax = xs[xs.length - 1]
  const xMin = xMax - windowSeconds
  const xSpan = Math.max(1, xMax - xMin)
  const effYMin = yMin ?? Math.min(...ys, ghost ?? ys[0])
  const effYMax = yMax ?? Math.max(...ys, ghost ?? ys[0])
  const ySpan = Math.max(1, effYMax - effYMin)

  const toX = (t: number) => ((t - xMin) / xSpan) * WIDTH
  const toY = (v: number) => HEIGHT - ((v - effYMin) / ySpan) * HEIGHT

  const scaled = points.map((p) => ({ x: toX(p.time_sec), y: toY(p.value) }))
  const path = monotonePath(scaled)
  const ghostPath =
    ghost !== undefined
      ? `M 0 ${toY(ghost).toFixed(2)} L ${WIDTH} ${toY(ghost).toFixed(2)}`
      : null

  // Dashed horizontal reference at the midpoint of the rendered axis.
  const midY = toY((effYMin + effYMax) / 2)
  const refPath = `M 0 ${midY.toFixed(2)} L ${WIDTH} ${midY.toFixed(2)}`

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
    >
      <path className={styles.ref} d={refPath} />
      <g ref={groupRef}>
        {ghostPath && <path className={styles.ghost} d={ghostPath} />}
        <path className={styles.line} d={path} />
      </g>
    </svg>
  )
}
