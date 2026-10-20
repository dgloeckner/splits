import { monotonePath } from '../../components/charts/path'
import type { SparkSpec } from './findingVisuals'
import styles from './FindingCard.module.css'

const WIDTH = 120
const HEIGHT = 32
const PAD = 2

/**
 * Small SVG sparkline for a finding card: the series the finding rests
 * on, with the slice it highlights shaded and its reference values as
 * flat lines. Decorative — the card's headline carries the number.
 */
export function FindingSparkline({ spec }: { spec: SparkSpec }) {
  const { series, shade, band, levels = [] } = spec
  const ys = [...series, ...levels.map((l) => l.y), ...(band ? [band.lo, band.hi] : [])]
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const n = series.length
  const toX = (i: number) => PAD + (i / Math.max(1, n - 1)) * (WIDTH - 2 * PAD)
  const toY = (y: number) => PAD + (1 - (y - yMin) / Math.max(1e-6, yMax - yMin)) * (HEIGHT - 2 * PAD)
  // Index ranges are [from, to) over buckets; a range's right edge sits
  // on its last bucket.
  const xEnd = (to: number) => toX(Math.max(0, to - 1))

  return (
    <svg className={styles.sparkline} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none"
      aria-hidden="true" data-testid="finding-sparkline">
      {shade && (
        <rect className={styles.sparkShade} x={toX(shade.from)} y={0}
          width={Math.max(0, xEnd(shade.to) - toX(shade.from))} height={HEIGHT} />
      )}
      {band && (
        <rect className={styles.sparkBand} x={PAD} width={WIDTH - 2 * PAD}
          y={toY(band.hi)} height={Math.max(0, toY(band.lo) - toY(band.hi))} />
      )}
      <path className={styles.sparkPath} d={monotonePath(series.map((y, i) => ({ x: toX(i), y: toY(y) })))} />
      {levels.map((l, i) => (
        <line key={i} className={styles.sparkLevel} x1={toX(l.from)} x2={xEnd(l.to)} y1={toY(l.y)} y2={toY(l.y)} />
      ))}
    </svg>
  )
}
