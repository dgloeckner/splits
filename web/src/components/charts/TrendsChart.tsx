import { useMemo, useRef } from 'react'
import type { TrendsRange } from '../../api/client'
import { monotonePath } from './path'
import { rangeRollingWindowDays, rollingAverage } from './rolling'
import { formatChartDate, formatStripDate, formatRollingDelta } from './format'
import { useChartScrubber, type ChartDot } from './useChartScrubber'
import styles from './TrendsChart.module.css'

const WIDTH = 300
const HEIGHT = 160
const LEFT_PAD = 34
const RIGHT_PAD = 4
const TOP_PAD = 6
const BOTTOM_PAD = 14
const PLOT_LEFT = LEFT_PAD
const PLOT_RIGHT = WIDTH - RIGHT_PAD
const PLOT_TOP = TOP_PAD
const PLOT_BOTTOM = HEIGHT - BOTTOM_PAD
const PLOT_W = PLOT_RIGHT - PLOT_LEFT
const PLOT_H = PLOT_BOTTOM - PLOT_TOP

export type TrendsChartSeries = {
  key: string
  label: string
  tone: 'primary' | 'neutral'
  variant: 'solid' | 'dashed'
  points: { t: number; y: number; sessionId: string }[]
  fmt: (v: number) => string
  /** True for metrics where lower is better (pace). Controls the strip delta chip's tone. */
  invertImprovement?: boolean
}

type Props = {
  series: TrendsChartSeries[]
  range: TrendsRange
  rollingFor?: 'primary-only' | 'none'
  onDotTap: (sessionId: string) => void
}

export function TrendsChart({ series, range, rollingFor = 'none', onDotTap }: Props) {
  const captureRef = useRef<SVGRectElement | null>(null)
  const windowDays = rangeRollingWindowDays(range)

  // --- Scales (x from data, y from data + drawn rolling avg) ---
  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    const allTs: number[] = []
    const allYs: number[] = []
    for (const s of series) {
      for (const p of s.points) {
        allTs.push(p.t)
        allYs.push(p.y)
      }
    }
    if (rollingFor === 'primary-only' && windowDays !== null && series.length > 0) {
      const r = rollingAverage(
        series[0].points.map((p) => ({ t: p.t, y: p.y })),
        windowDays,
      )
      for (const p of r) allYs.push(p.y)
    }
    if (allTs.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }
    const xMn = Math.min(...allTs)
    const xMx = Math.max(...allTs)
    const yMn = Math.min(...allYs)
    const yMx = Math.max(...allYs)
    const ySpan = Math.max(1e-6, yMx - yMn)
    return {
      xMin: xMn,
      xMax: xMx,
      yMin: yMn - ySpan * 0.05,
      yMax: yMx + ySpan * 0.05,
    }
  }, [series, rollingFor, windowDays])

  const toX = (t: number) => PLOT_LEFT + ((t - xMin) / Math.max(1, xMax - xMin)) * PLOT_W
  const toY = (y: number) => PLOT_TOP + (1 - (y - yMin) / Math.max(1e-6, yMax - yMin)) * PLOT_H

  // --- Rolling avgs for every series (drawn or not — strip uses all) ---
  const rollingBySeries = useMemo(() => {
    const out: { t: number; y: number }[][] = []
    for (const s of series) {
      if (windowDays === null) {
        out.push([])
        continue
      }
      out.push(rollingAverage(s.points.map((p) => ({ t: p.t, y: p.y })), windowDays))
    }
    return out
  }, [series, windowDays])

  // --- Dot capture data for scrubber hook (x in viewBox units) ---
  const dots: ChartDot[] = useMemo(() => {
    const out: ChartDot[] = []
    for (const s of series) {
      for (const p of s.points) {
        out.push({ x: toX(p.t), sessionId: p.sessionId })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, xMin, xMax])

  const { scrubX, handlers } = useChartScrubber({
    getPlotRect: () => {
      const el = captureRef.current
      return el ? el.getBoundingClientRect() : null
    },
    dots,
    onDotTap,
  })

  // --- Active point per series (latest in idle, nearest-to-scrub when active) ---
  const activeIndexes: number[] = useMemo(() => {
    return series.map((s) => {
      if (s.points.length === 0) return -1
      if (scrubX === null) return s.points.length - 1
      let best = 0
      let bestDist = Math.abs(toX(s.points[0].t) - scrubX)
      for (let i = 1; i < s.points.length; i++) {
        const d = Math.abs(toX(s.points[i].t) - scrubX)
        if (d < bestDist) {
          best = i
          bestDist = d
        }
      }
      return best
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, scrubX])

  const activeT = useMemo(() => {
    if (series.length === 0 || activeIndexes[0] < 0) return null
    return series[0].points[activeIndexes[0]].t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, activeIndexes])

  // --- 3 y-ticks (top, middle, bottom of the padded data range) ---
  const yTicks = useMemo(() => {
    if (yMin === yMax) return [yMin]
    const span = yMax - yMin
    return [yMax - span * 0.05, (yMax + yMin) / 2, yMin + span * 0.05]
  }, [yMin, yMax])

  // --- 3-5 x-ticks depending on range ---
  const xTickCount = range === 'week' ? 4 : range === 'all' ? 5 : 3
  const xTicks = useMemo(() => {
    if (xMin === xMax) return [xMin]
    const out: number[] = []
    for (let i = 0; i < xTickCount; i++) {
      out.push(xMin + ((xMax - xMin) * i) / (xTickCount - 1))
    }
    return out
  }, [xMin, xMax, xTickCount])

  return (
    <div className={styles.wrap}>
      <div className={styles.strip}>
        <div className={styles.stripDate} data-testid="trends-strip-date">
          {activeT !== null ? formatStripDate(activeT) : ''}
        </div>
        {series.map((s, i) => {
          const idx = activeIndexes[i]
          if (idx < 0) return null
          const pt = s.points[idx]
          const r = rollingBySeries[i]
          const ravg = r.find((rp) => rp.t === pt.t)?.y ?? null
          const delta = formatRollingDelta(pt.y, ravg, windowDays, s.fmt, s.invertImprovement)
          const isImprovement = ravg !== null && (s.invertImprovement ? pt.y < ravg : pt.y > ravg)
          return (
            <div
              key={s.key}
              className={`${styles.stripRow} ${s.tone === 'neutral' ? styles.stripRowMuted : ''}`}
              data-testid={`trends-strip-row-${s.key}`}
            >
              <span className={s.tone === 'neutral' ? `${styles.dot} ${styles.dotNeutral}` : styles.dot} />
              <span>{s.label}</span>
              <span className={styles.stripValue}>{s.fmt(pt.y)}</span>
              <span
                className={`${styles.stripDelta} ${
                  delta === '—' ? '' : isImprovement ? styles.stripDeltaImprovement : styles.stripDeltaRegression
                }`}
              >
                {delta}
              </span>
            </div>
          )
        })}
      </div>

      <svg
        className={styles.svg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ height: HEIGHT }}
        role="img"
        aria-label={series.map((s) => s.label).join(', ')}
      >
        {yTicks.map((y, i) => (
          <line
            key={`grid-${i}`}
            data-testid="trends-chart-gridline"
            className={styles.grid}
            x1={PLOT_LEFT}
            x2={PLOT_RIGHT}
            y1={toY(y)}
            y2={toY(y)}
          />
        ))}
        <line className={styles.baseline} x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} />

        {yTicks.map((y, i) => (
          <text key={`yl-${i}`} className={styles.axisLabel} x={4} y={toY(y) + 3}>
            {series[0]?.fmt(y) ?? ''}
          </text>
        ))}

        {xTicks.map((t, i) => (
          <text
            key={`xl-${i}`}
            className={styles.axisLabel}
            x={toX(t)}
            y={HEIGHT - 3}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {formatChartDate(t, range)}
          </text>
        ))}

        {rollingFor === 'primary-only' &&
          windowDays !== null &&
          series.length > 0 &&
          rollingBySeries[0].length > 1 && (
            <path
              data-testid="trends-chart-rolling"
              className={styles.rollingPath}
              d={monotonePath(rollingBySeries[0].map((p) => ({ x: toX(p.t), y: toY(p.y) })))}
            />
          )}

        {series.map((s) => {
          if (s.points.length < 2) return null
          const pts = s.points.map((p) => ({ x: toX(p.t), y: toY(p.y) }))
          const classes = [
            s.tone === 'primary' ? styles.seriesPathPrimary : styles.seriesPathNeutral,
            s.variant === 'dashed' ? styles.seriesPathDashed : '',
          ].join(' ')
          return <path key={`p-${s.key}`} className={classes} d={monotonePath(pts)} />
        })}

        {series.flatMap((s, sIdx) =>
          s.points.map((p, pIdx) => {
            const isActive = scrubX !== null && activeIndexes[sIdx] === pIdx
            return (
              <g key={`d-${s.key}-${pIdx}`}>
                <circle
                  data-testid="trends-chart-dot"
                  className={s.tone === 'primary' ? styles.dotPrimary : styles.dotNeutralFill}
                  cx={toX(p.t)}
                  cy={toY(p.y)}
                  r={3}
                />
                {isActive && (
                  <circle className={styles.activeRing} cx={toX(p.t)} cy={toY(p.y)} r={6} />
                )}
              </g>
            )
          }),
        )}

        {scrubX !== null && (
          <line
            className={styles.guideline}
            x1={scrubX}
            x2={scrubX}
            y1={PLOT_TOP}
            y2={PLOT_BOTTOM}
          />
        )}

        <rect
          ref={captureRef}
          data-testid="trends-chart-capture"
          className={styles.capture}
          x={PLOT_LEFT}
          y={PLOT_TOP}
          width={PLOT_W}
          height={PLOT_H}
          {...handlers}
        />
      </svg>
    </div>
  )
}
