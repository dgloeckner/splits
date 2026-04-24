import { useEffect, useMemo, useState } from 'react'
import { selectSparkline, sparklineMetric } from './selectors'
import type { TileDef } from './registry'
import type { LiveState } from '../live/reducer'
import { Sparkline } from '../components/Sparkline/Sparkline'
import { smoothingConfig } from '../live/smoothing'
import { computeAxis, type SparklineMetric } from '../live/sparklineAxis'
import { fmtFloat, fmtInt } from '../util/format'
import styles from './SparklineTile.module.css'

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
  const tablet = useIsTablet()
  const windowSeconds = tablet
    ? smoothingConfig.sparkline.windowSeconds.tablet
    : smoothingConfig.sparkline.windowSeconds.phone

  const axis = useMemo(() => {
    if (!metric) return null
    const values = points.map((p) => p.value).filter((v) => isAxisValueValid(v, metric))
    return computeAxis(values, metric)
  }, [points, metric])

  const hasData = points.length > 0
  const current = hasData ? points[points.length - 1].value : null

  const cls = [styles.tile, disabled && styles.disabled].filter(Boolean).join(' ')
  const showEdges = metric && axis && axis.dataMin !== null && axis.dataMax !== null

  return (
    <div className={cls}>
      <div className={styles.topRow}>
        <span className={`label-sm ${styles.label}`}>{def.label}</span>
        {metric && hasData && current !== null && (
          <span className={styles.current}>{formatForMetric(current, metric)}</span>
        )}
      </div>
      <div className={styles.canvas}>
        <Sparkline
          points={points}
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
