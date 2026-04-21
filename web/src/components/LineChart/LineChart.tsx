import styles from './LineChart.module.css'

const WIDTH = 300
const HEIGHT = 120

export type Point = { x: number; y: number }

type Props = {
  title: string
  points: Point[]
  /** Optional formatter for the y-axis min/max labels (e.g. `mmss`). */
  fmt?: (v: number) => string
}

export function LineChart({ title, points, fmt = (v) => String(Math.round(v)) }: Props) {
  if (points.length === 0) {
    return (
      <section className={styles.wrap}>
        <header className={styles.header}>
          <span className={`label-sm ${styles.title}`}>{title}</span>
        </header>
        <div className={styles.empty}>Keine Daten</div>
      </section>
    )
  }

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const xSpan = Math.max(1, xMax - xMin)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const ySpan = Math.max(1, yMax - yMin)

  const toX = (x: number) => ((x - xMin) / xSpan) * WIDTH
  const toY = (y: number) => HEIGHT - ((y - yMin) / ySpan) * HEIGHT

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <span className={`label-sm ${styles.title}`}>{title}</span>
        <span className={styles.range}>
          {fmt(yMin)} — {fmt(yMax)}
        </span>
      </header>
      <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
        {points.length === 1 ? (
          <circle className={styles.dot} cx={toX(points[0].x)} cy={toY(points[0].y)} r={3} />
        ) : (
          <path
            className={styles.line}
            d={points
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x).toFixed(2)} ${toY(p.y).toFixed(2)}`)
              .join(' ')}
          />
        )}
      </svg>
    </section>
  )
}
