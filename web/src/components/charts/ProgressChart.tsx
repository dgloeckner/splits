import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { monotonePath } from './path'
import { rollingAverage } from './rolling'
import { formatStripDate } from './format'
import { formatStripDelta, isImprovement } from './stripDelta'
import { selectXTicksAtCalendarBoundaries, selectYTicksRound, type ChartMetric } from './ticks'
import { useChartScrubber, type ChartDot } from './useChartScrubber'
import styles from './ProgressChart.module.css'

// Fallback width until the container is measured (and in jsdom).
const DEFAULT_WIDTH = 300
const HEIGHT = 180
const LEFT_PAD = 40
const RIGHT_PAD = 52
const TOP_PAD = 8
const BOTTOM_PAD = 22
const PLOT_LEFT = LEFT_PAD
const PLOT_TOP = TOP_PAD
const PLOT_BOTTOM = HEIGHT - BOTTOM_PAD
const PLOT_H = PLOT_BOTTOM - PLOT_TOP
// Minimum vertical gap between the right-edge direct labels (PB, Ø).
const LABEL_GAP = 11

/** label: the workout chip shown in the strip; set on context dots only. */
export type ProgressPoint = { t: number; y: number; sessionId: string; label?: string }

export type ProgressChartProps = {
  /** Completed sessions of the selected shape — the line. */
  linePoints: ProgressPoint[]
  /** Every other session in the window — faint dots. */
  contextDots: ProgressPoint[]
  /** Legend label of the line, the series' display name. */
  lineLabel?: string
  metric: ChartMetric
  fmt: (v: number) => string
  /** Window bounds (ms) — the x-domain; ticks derive from these. */
  windowFromMs: number
  windowToMs: number
  rollingWindowDays: number
  /** Gold PB reference (Split mode only); null/undefined → not drawn. */
  pbValue?: number | null
  pbLabel?: string
  selectedSessionId?: string | null
  /** Tap on a dot — open the session. Scrub reports the hovered session. */
  onDotTap: (sessionId: string) => void
  onScrubSession?: (sessionId: string | null) => void
}

// Render in real pixels instead of stretching a fixed viewBox: with
// preserveAspectRatio="none" text and dots distort on wide screens.
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  useLayoutEffect(() => {
    const w = ref.current?.getBoundingClientRect().width
    if (w) setWidth(w)
  }, [])
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      if (w) setWidth(w)
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

// Push the two right-edge labels apart when their lines sit close
// together (PB and Ø often coincide).
function separateLabels(a: number | null, b: number | null): [number | null, number | null] {
  if (a === null || b === null || Math.abs(a - b) >= LABEL_GAP) return [a, b]
  const mid = (a + b) / 2
  const [lo, hi] = [mid - LABEL_GAP / 2, mid + LABEL_GAP / 2]
  return a <= b ? [lo, hi] : [hi, lo]
}

export function ProgressChart(p: ProgressChartProps) {
  const { ref: wrapRef, width } = useMeasuredWidth()
  const plotRight = width - RIGHT_PAD
  const plotW = plotRight - PLOT_LEFT
  const captureRef = useRef<SVGRectElement | null>(null)
  const all = useMemo(() => [...p.linePoints, ...p.contextDots], [p.linePoints, p.contextDots])

  const rolling = useMemo(
    () => rollingAverage(p.linePoints.map((q) => ({ t: q.t, y: q.y })), p.rollingWindowDays),
    [p.linePoints, p.rollingWindowDays],
  )

  const yTicks = useMemo(() => {
    const ys = all.map((q) => q.y).concat(rolling.map((r) => r.y))
    if (p.pbValue) ys.push(p.pbValue)
    if (ys.length === 0) return []
    return selectYTicksRound(Math.min(...ys), Math.max(...ys), p.metric)
  }, [all, rolling, p.pbValue, p.metric])

  const yMin = yTicks[0] ?? 0
  const yMax = yTicks[yTicks.length - 1] ?? 1
  const xMin = p.windowFromMs
  const xMax = p.windowToMs
  const toX = (t: number) => PLOT_LEFT + ((t - xMin) / Math.max(1, xMax - xMin)) * plotW
  const toY = (y: number) => PLOT_TOP + (1 - (y - yMin) / Math.max(1e-6, yMax - yMin)) * PLOT_H

  const xTicks = useMemo(() => selectXTicksAtCalendarBoundaries(xMin, xMax), [xMin, xMax])

  const dots: ChartDot[] = useMemo(
    () => all.map((q) => ({ x: toX(q.t), sessionId: q.sessionId })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, xMin, xMax, width],
  )

  const { scrubX, handlers } = useChartScrubber({
    // Dot x positions are SVG coordinates (they include PLOT_LEFT), so the
    // pointer is measured from the SVG's left edge, not the capture rect's.
    getPlotRect: () => captureRef.current?.ownerSVGElement?.getBoundingClientRect() ?? null,
    dots,
    onDotTap: p.onDotTap,
  })

  const active = useMemo(() => {
    if (scrubX !== null && all.length > 0) {
      let best = all[0]
      for (const q of all) if (Math.abs(toX(q.t) - scrubX) < Math.abs(toX(best.t) - scrubX)) best = q
      return best
    }
    if (p.selectedSessionId) {
      const sel = all.find((q) => q.sessionId === p.selectedSessionId)
      if (sel) return sel
    }
    return p.linePoints[p.linePoints.length - 1] ?? all[all.length - 1] ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubX, all, p.selectedSessionId, p.linePoints, width])

  const lastReported = useRef<string | null>(null)
  const activeId = scrubX !== null ? (active?.sessionId ?? null) : null
  if (activeId !== lastReported.current) {
    lastReported.current = activeId
    p.onScrubSession?.(activeId)
  }

  const contextIds = useMemo(() => new Set(p.contextDots.map((q) => q.sessionId)), [p.contextDots])
  // The delta compares against the line's rolling average, which says
  // nothing about a 500 m dot on a 5 k line.
  const activeIsContext = active !== null && contextIds.has(active.sessionId)
  const ravg = active ? (rolling.find((r) => r.t === active.t)?.y ?? null) : null
  const lastRolling = rolling[rolling.length - 1]
  const showPb = p.pbValue != null && p.pbValue >= yMin && p.pbValue <= yMax
  const showRolling = rolling.length > 1
  const [pbLabelY, rollingLabelY] = separateLabels(
    showPb ? toY(p.pbValue as number) : null,
    showRolling && lastRolling ? toY(lastRolling.y) : null,
  )

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.strip} data-testid="progress-strip">
        <span className={styles.stripWhen}>
          <span className={styles.stripDate}>{active ? formatStripDate(active.t) : ''}</span>
          {active?.label && (
            <span className={styles.stripShape} data-testid="progress-strip-shape">{active.label}</span>
          )}
        </span>
        {active && (
          <span className={styles.stripReadout}>
            <span className={styles.stripValue}>{p.fmt(active.y)}</span>
            {activeIsContext ? (
              // Holds the delta's width so the strip does not reflow and
              // move the chart under the finger.
              <span className={`${styles.stripDelta} ${styles.stripDeltaHold}`} aria-hidden="true">
                {formatStripDelta(1, 0, p.rollingWindowDays, p.metric)}
              </span>
            ) : (
              <span
                className={
                  ravg !== null && isImprovement(active.y, ravg, p.metric)
                    ? styles.stripDeltaGood
                    : styles.stripDelta
                }
                data-testid="progress-strip-delta"
              >
                {formatStripDelta(active.y, ravg, p.rollingWindowDays, p.metric)}
              </span>
            )}
          </span>
        )}
      </div>

      <svg className={styles.svg} viewBox={`0 0 ${width} ${HEIGHT}`}
        width={width} height={HEIGHT} role="img" aria-label="Verlauf">
        {yTicks.map((y) => (
          <g key={`y-${y}`}>
            <line data-testid="progress-gridline" className={styles.grid}
              x1={PLOT_LEFT} x2={plotRight} y1={toY(y)} y2={toY(y)} />
            <text className={styles.axisLabel} x={PLOT_LEFT - 6} y={toY(y) + 3}
              textAnchor="end">{p.fmt(y)}</text>
          </g>
        ))}
        {xTicks.map((tk) => (
          <text key={`x-${tk.t}`} data-testid="progress-xtick" className={styles.axisLabel}
            x={toX(tk.t)} y={HEIGHT - 5} textAnchor="middle">{tk.label}</text>
        ))}

        {showPb && p.pbValue != null && pbLabelY !== null && (
          <g data-testid="progress-pb-line">
            <line className={styles.pbLine} x1={PLOT_LEFT} x2={plotRight}
              y1={toY(p.pbValue)} y2={toY(p.pbValue)} />
            <text className={styles.pbLabel} x={plotRight + 4} y={pbLabelY + 3}>
              {p.pbLabel ?? `PB ${p.fmt(p.pbValue)}`}
            </text>
          </g>
        )}

        {showRolling && (
          <g data-testid="progress-rolling">
            <path className={styles.rollingPath}
              d={monotonePath(rolling.map((r) => ({ x: toX(r.t), y: toY(r.y) })))} />
            {rollingLabelY !== null && (
              <text className={styles.rollingLabel} x={plotRight + 4} y={rollingLabelY + 3}>
                {`Ø ${p.rollingWindowDays} T`}
              </text>
            )}
          </g>
        )}

        {p.linePoints.length > 1 && (
          <path className={styles.seriesPath}
            d={monotonePath(p.linePoints.map((q) => ({ x: toX(q.t), y: toY(q.y) })))} />
        )}

        {p.contextDots.map((q) => (
          <circle key={`ctx-${q.sessionId}`} data-testid="progress-context-dot"
            className={styles.contextDot} cx={toX(q.t)} cy={toY(q.y)} r={2.5} />
        ))}
        {p.linePoints.map((q) => (
          <circle key={`ln-${q.sessionId}`} data-testid="progress-line-dot"
            className={styles.lineDot} cx={toX(q.t)} cy={toY(q.y)} r={3} />
        ))}
        {active && (scrubX !== null || p.selectedSessionId === active.sessionId) && (
          <circle className={styles.activeRing} cx={toX(active.t)} cy={toY(active.y)} r={6} />
        )}
        {scrubX !== null && (
          <line className={styles.guideline} x1={scrubX} x2={scrubX} y1={PLOT_TOP} y2={PLOT_BOTTOM} />
        )}
        <rect ref={captureRef} data-testid="progress-capture" className={styles.capture}
          x={PLOT_LEFT} y={PLOT_TOP} width={plotW} height={PLOT_H} {...handlers} />
      </svg>

      {p.contextDots.length > 0 && (
        <div className={styles.legend} data-testid="progress-legend">
          {p.linePoints.length > 0 && (
            <span className={styles.legendItem}>
              <span className={`${styles.legendSwatch} ${styles.legendLine}`} aria-hidden="true" />
              {p.lineLabel}
            </span>
          )}
          <span className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.legendContext}`} aria-hidden="true" />
            {p.linePoints.length > 0 ? 'andere Sessions' : 'Sessions'}
          </span>
        </div>
      )}
    </div>
  )
}
