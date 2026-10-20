import { useMemo } from 'react'
import { clampY, workingYRange, type XRange } from './domain'
import { monotonePath } from './path'
import { selectTimeAxisTicks, selectYTicksRound, type ChartMetric } from './ticks'
import styles from './ProgressChart.module.css'

const WIDTH = 300
const HEIGHT = 120
const LEFT_PAD = 34
const RIGHT_PAD = 40
const TOP_PAD = 6
const BOTTOM_PAD = 14

export type SessionChartProps = {
  title: string
  /** x = seconds into the session, y = metric value. */
  points: { x: number; y: number }[]
  metric: ChartMetric
  fmt: (v: number) => string
  /** Session average — grey dashed reference, direct-labeled. */
  avgValue?: number | null
  /**
   * The analysis window as an x-range. The y-domain is the working
   * range inside it (a trimmed range of all points without one);
   * points outside the domain are clipped to the plot edge.
   */
  focus?: XRange | null
}

export function SessionChart({ title, points, metric, fmt, avgValue, focus }: SessionChartProps) {
  const xMin = points[0]?.x ?? 0
  const xMax = points[points.length - 1]?.x ?? 1
  const yTicks = useMemo(() => {
    const range = workingYRange(points, focus)
    const ys = range ? [range.min, range.max] : []
    if (avgValue != null) ys.push(avgValue)
    if (ys.length === 0) return []
    return selectYTicksRound(Math.min(...ys), Math.max(...ys), metric)
  }, [points, avgValue, metric, focus])
  const yMin = yTicks[0] ?? 0
  const yMax = yTicks[yTicks.length - 1] ?? 1
  const plotRight = WIDTH - RIGHT_PAD
  const plotBottom = HEIGHT - BOTTOM_PAD
  const toX = (x: number) => LEFT_PAD + ((x - xMin) / Math.max(1, xMax - xMin)) * (plotRight - LEFT_PAD)
  const toY = (y: number) => TOP_PAD + (1 - (y - yMin) / Math.max(1e-6, yMax - yMin)) * (plotBottom - TOP_PAD)
  const xTicks = useMemo(() => selectTimeAxisTicks(xMin, xMax), [xMin, xMax])

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <figure className={styles.sessionChart}>
      <figcaption className={styles.sessionChartTitle}>{title}</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" style={{ height: HEIGHT }}
        role="img" aria-label={title}>
        {yTicks.map((y) => (
          <g key={`y-${y}`}>
            <line className={styles.grid} x1={LEFT_PAD} x2={plotRight} y1={toY(y)} y2={toY(y)} />
            <text className={styles.axisLabel} x={4} y={toY(y) + 3}>{fmt(y)}</text>
          </g>
        ))}
        {xTicks.map((x) => (
          <text key={`x-${x}`} className={styles.axisLabel} x={toX(x)} y={HEIGHT - 3} textAnchor="middle">
            {fmtTime(x)}
          </text>
        ))}
        {avgValue != null && avgValue >= yMin && avgValue <= yMax && (
          <g data-testid="session-chart-avg">
            <line className={styles.rollingPath} x1={LEFT_PAD} x2={plotRight}
              y1={toY(avgValue)} y2={toY(avgValue)} />
            <text className={styles.rollingLabel} x={plotRight + 2} y={toY(avgValue) + 3}>
              {`Ø ${fmt(avgValue)}`}
            </text>
          </g>
        )}
        {points.length > 1 && (
          <path className={styles.seriesPath}
            d={monotonePath(points.map((p) => ({ x: toX(p.x), y: toY(clampY(p.y, yMin, yMax)) })))} />
        )}
      </svg>
    </figure>
  )
}
