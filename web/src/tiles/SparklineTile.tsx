import { useEffect, useMemo, useState } from 'react'
import { selectSparkline, sparklineMetric } from './selectors'
import type { TileDef } from './registry'
import type { LiveState, SparklinePoint } from '../live/reducer'
import { Sparkline } from '../components/Sparkline/Sparkline'
import { smoothingConfig } from '../live/smoothing'
import { computeAxis, type SparklineMetric } from '../live/sparklineAxis'
import { useIsLivePaused } from '../live/useLiveDisplay'
import { fmtFloat, fmtInt } from '../util/format'
import styles from './SparklineTile.module.css'

// Rolling mean over the last `window` non-null samples. Nulls (pause
// markers) pass through unchanged and reset the buffer so a gap doesn't
// bleed pre-pause values into post-pause averages.
function rollingMean(points: SparklinePoint[], window: number): SparklinePoint[] {
  const buf: number[] = []
  return points.map((p) => {
    if (p.value === null) {
      buf.length = 0
      return p
    }
    buf.push(p.value)
    if (buf.length > window) buf.shift()
    const mean = buf.reduce((a, b) => a + b, 0) / buf.length
    return { time_sec: p.time_sec, value: mean }
  })
}

type Props = { def: TileDef; state: LiveState; disabled?: boolean }

function useIsTablet(): boolean {
  const [tablet, setTablet] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
      return false
    return window.matchMedia('(min-width: 768px)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setTablet(e.matches)
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else mq.addListener(handler)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else mq.removeListener(handler)
    }
  }, [])
  return tablet
}

function isAxisValueValid(v: number, metric: SparklineMetric): boolean {
  if (!Number.isFinite(v)) return false
  if (metric === 'split') return v > 0 && v < 600
  return v > 0
}

function paceShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatForMetric(value: number, metric: SparklineMetric): string {
  switch (metric) {
    case 'watts':
      return fmtInt(value)
    case 'split':
      return paceShort(value)
    case 'dps':
      return fmtFloat(value, 1)
    case 'spm':
      return fmtInt(value)
    case 'hf':
      return fmtInt(value)
  }
}

export function SparklineTile({ def, state, disabled }: Props) {
  const { points } = selectSparkline(state, def.id)
  const metric = sparklineMetric(def.id)
  const paused = useIsLivePaused(state)
  const tablet = useIsTablet()
  const windowSeconds = tablet
    ? smoothingConfig.sparkline.windowSeconds.tablet
    : smoothingConfig.sparkline.windowSeconds.phone

  const axis = useMemo(() => {
    if (!metric) return null
    const values = points
      .map((p) => p.value)
      .filter((v): v is number => v !== null)
      .filter((v) => isAxisValueValid(v, metric))
    return computeAxis(values, metric)
  }, [points, metric])

  const lastNonNull = [...points].reverse().find((p) => p.value !== null) ?? null
  const hasData = lastNonNull !== null
  const current = lastNonNull?.value ?? null

  // Visualize split as a rolling mean of the last 3 strokes so the trend
  // reads cleanly, but keep watts raw — its per-stroke drive/recovery
  // variation is the point of that sparkline.
  const linePoints = useMemo(
    () => (metric === 'split' ? rollingMean(points, 3) : points),
    [points, metric],
  )

  const cls = [styles.tile, disabled && styles.disabled].filter(Boolean).join(' ')
  const showEdges = metric && axis && axis.dataMin !== null && axis.dataMax !== null

  return (
    <div className={cls}>
      <div className={styles.topRow}>
        <span className={`label-sm ${styles.label}`}>{def.label}</span>
        {metric && hasData && current !== null && !paused && (
          <span className={styles.current}>{formatForMetric(current, metric)}</span>
        )}
        {paused && <span className={styles.current}>—</span>}
      </div>
      <div className={styles.canvas}>
        <Sparkline
          points={linePoints}
          windowSeconds={windowSeconds}
          yMin={axis?.yMin}
          yMax={axis?.yMax}
        />
      </div>
      {showEdges && (
        <div className={styles.edges}>
          <span className={styles.edgeMin}>{formatForMetric(axis.dataMin!, metric!)}</span>
          <span className={styles.edgeMax}>{formatForMetric(axis.dataMax!, metric!)}</span>
        </div>
      )}
    </div>
  )
}
