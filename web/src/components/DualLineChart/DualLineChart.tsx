import { monotonePath } from '../charts/path'
import styles from './DualLineChart.module.css'

const WIDTH = 300
const HEIGHT = 160

export type Series = {
  label: string
  points: { x: number; y: number }[]
  variant: 'solid' | 'dashed'
  tone: 'primary' | 'neutral'
  fmt?: (v: number) => string
}

type Props = {
  primary: Series
  secondary?: Series
  height?: number
}

// DualLineChart is a hand-rolled SVG with shared x-domain and two
// independent y-scales. v1 has no axes/grid/tooltips — see
// 2026-04-26-history-trends-design spec.
export function DualLineChart({ primary, secondary, height = HEIGHT }: Props) {
  const allXs: number[] = []
  if (primary.points.length > 0) allXs.push(...primary.points.map((p) => p.x))
  if (secondary && secondary.points.length > 0) allXs.push(...secondary.points.map((p) => p.x))

  if (allXs.length === 0) {
    return (
      <div className={styles.wrap} data-testid="dlc-empty">
        <div className={styles.empty} style={{ height }}>
          Keine Daten
        </div>
      </div>
    )
  }

  const xMin = Math.min(...allXs)
  const xMax = Math.max(...allXs)
  const xSpan = Math.max(1, xMax - xMin)
  const toX = (x: number) => ((x - xMin) / xSpan) * WIDTH

  const renderSeries = (s: Series, key: string, testId: string) => {
    if (s.points.length === 0) return null
    const ys = s.points.map((p) => p.y)
    const yMin = Math.min(...ys)
    const yMax = Math.max(...ys)
    const ySpan = Math.max(1e-6, yMax - yMin)
    const toY = (y: number) => height - ((y - yMin) / ySpan) * height
    const cls = [
      styles.line,
      s.variant === 'dashed' ? styles.dashed : styles.solid,
      s.tone === 'primary' ? styles.primary : styles.neutral,
    ].join(' ')
    if (s.points.length === 1) {
      return (
        <circle
          key={key}
          data-testid={testId}
          className={cls}
          cx={toX(s.points[0].x)}
          cy={toY(s.points[0].y)}
          r={3}
        />
      )
    }
    const d = monotonePath(s.points.map((p) => ({ x: toX(p.x), y: toY(p.y) })))
    return <path key={key} data-testid={testId} className={cls} d={d} />
  }

  return (
    <div className={styles.wrap}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        style={{ height }}
        role="img"
        aria-label={
          secondary ? `${primary.label} & ${secondary.label}` : primary.label
        }
      >
        {renderSeries(primary, 'p', 'dlc-primary')}
        {secondary && renderSeries(secondary, 's', 'dlc-secondary')}
      </svg>
    </div>
  )
}
