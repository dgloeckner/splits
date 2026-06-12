import { useMemo, useRef } from 'react'
import { monotonePath } from './path'
import { rollingAverage } from './rolling'
import { formatStripDate } from './format'
import { formatStripDelta, isImprovement } from './stripDelta'
import { selectXTicksAtCalendarBoundaries, selectYTicksRound, type ChartMetric } from './ticks'
import { useChartScrubber, type ChartDot } from './useChartScrubber'
import styles from './ProgressChart.module.css'

const WIDTH = 300
const HEIGHT = 170
const LEFT_PAD = 34
const RIGHT_PAD = 40
const TOP_PAD = 6
const BOTTOM_PAD = 14
const PLOT_LEFT = LEFT_PAD
const PLOT_RIGHT = WIDTH - RIGHT_PAD
const PLOT_TOP = TOP_PAD
const PLOT_BOTTOM = HEIGHT - BOTTOM_PAD
const PLOT_W = PLOT_RIGHT - PLOT_LEFT
const PLOT_H = PLOT_BOTTOM - PLOT_TOP

export type ProgressPoint = { t: number; y: number; sessionId: string }

export type ProgressChartProps = {
  /** Completed sessions of the selected shape — the line. */
  linePoints: ProgressPoint[]
  /** Every other session in the window — faint dots. */
  contextDots: ProgressPoint[]
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

export function ProgressChart(p: ProgressChartProps) {
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
  const toX = (t: number) => PLOT_LEFT + ((t - xMin) / Math.max(1, xMax - xMin)) * PLOT_W
  const toY = (y: number) => PLOT_TOP + (1 - (y - yMin) / Math.max(1e-6, yMax - yMin)) * PLOT_H

  const xTicks = useMemo(() => selectXTicksAtCalendarBoundaries(xMin, xMax), [xMin, xMax])

  const dots: ChartDot[] = useMemo(
    () => all.map((q) => ({ x: toX(q.t), sessionId: q.sessionId })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, xMin, xMax],
  )

  const { scrubX, handlers } = useChartScrubber({
    getPlotRect: () => captureRef.current?.getBoundingClientRect() ?? null,
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
  }, [scrubX, all, p.selectedSessionId, p.linePoints])

  const lastReported = useRef<string | null>(null)
  const activeId = scrubX !== null ? (active?.sessionId ?? null) : null
  if (activeId !== lastReported.current) {
    lastReported.current = activeId
    p.onScrubSession?.(activeId)
  }

  const ravg = active ? (rolling.find((r) => r.t === active.t)?.y ?? null) : null
  const lastRolling = rolling[rolling.length - 1]

  return (
    <div className={styles.wrap}>
      <div className={styles.strip} data-testid="progress-strip">
        <span className={styles.stripDate}>{active ? formatStripDate(active.t) : ''}</span>
        {active && (
          <>
            <span className={styles.stripValue}>{p.fmt(active.y)}</span>
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
          </>
        )}
      </div>

      <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none"
        style={{ height: HEIGHT }} role="img" aria-label="Verlauf">
        {yTicks.map((y) => (
          <g key={`y-${y}`}>
            <line data-testid="progress-gridline" className={styles.grid}
              x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={toY(y)} y2={toY(y)} />
            <text className={styles.axisLabel} x={4} y={toY(y) + 3}>{p.fmt(y)}</text>
          </g>
        ))}
        {xTicks.map((tk) => (
          <text key={`x-${tk.t}`} data-testid="progress-xtick" className={styles.axisLabel}
            x={toX(tk.t)} y={HEIGHT - 3} textAnchor="middle">{tk.label}</text>
        ))}

        {p.pbValue != null && p.pbValue >= yMin && p.pbValue <= yMax && (
          <g data-testid="progress-pb-line">
            <line className={styles.pbLine} x1={PLOT_LEFT} x2={PLOT_RIGHT}
              y1={toY(p.pbValue)} y2={toY(p.pbValue)} />
            <text className={styles.pbLabel} x={PLOT_RIGHT + 2} y={toY(p.pbValue) + 3}>
              {p.pbLabel ?? `PB ${p.fmt(p.pbValue)}`}
            </text>
          </g>
        )}

        {rolling.length > 1 && (
          <g data-testid="progress-rolling">
            <path className={styles.rollingPath}
              d={monotonePath(rolling.map((r) => ({ x: toX(r.t), y: toY(r.y) })))} />
            {lastRolling && (
              <text className={styles.rollingLabel} x={PLOT_RIGHT + 2} y={toY(lastRolling.y) + 3}>
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
          x={PLOT_LEFT} y={PLOT_TOP} width={PLOT_W} height={PLOT_H} {...handlers} />
      </svg>
    </div>
  )
}
