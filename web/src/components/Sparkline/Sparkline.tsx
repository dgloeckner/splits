import type { SparklinePoint } from '../../live/reducer'
import styles from './Sparkline.module.css'

type Props = {
  points: SparklinePoint[]
  /** Optional ghost line at a constant y — used for session-average. */
  ghost?: number
}

const WIDTH = 100
const HEIGHT = 40

export function Sparkline({ points, ghost }: Props) {
  if (points.length === 0) {
    return <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} />
  }

  const xs = points.map((p) => p.time_sec)
  const ys = points.map((p) => p.value)
  const xMin = xs[0]
  const xMax = xs[xs.length - 1]
  const xSpan = Math.max(1, xMax - xMin)
  const yMin = Math.min(...ys, ghost ?? ys[0])
  const yMax = Math.max(...ys, ghost ?? ys[0])
  const ySpan = Math.max(1, yMax - yMin)

  const toX = (t: number) => ((t - xMin) / xSpan) * WIDTH
  const toY = (v: number) => HEIGHT - ((v - yMin) / ySpan) * HEIGHT

  if (points.length === 1) {
    return (
      <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <circle
          className={styles.dot}
          cx={toX(points[0].time_sec)}
          cy={toY(points[0].value)}
          r={2}
        />
      </svg>
    )
  }

  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${toX(p.time_sec).toFixed(2)} ${toY(p.value).toFixed(2)}`,
    )
    .join(' ')

  const ghostPath =
    ghost !== undefined
      ? `M 0 ${toY(ghost).toFixed(2)} L ${WIDTH} ${toY(ghost).toFixed(2)}`
      : null

  return (
    <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
      {ghostPath && <path className={styles.ghost} d={ghostPath} />}
      <path className={styles.line} d={path} />
    </svg>
  )
}
