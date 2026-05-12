import type { RaceResultLatch } from './raceResultLatch'
import styles from './FinishOverlay.module.css'

/**
 * Finish-horn overlay (0014-06). Slides in from the bottom and sits at
 * ~40% of the viewport height. Does NOT unmount the canvas — the
 * caller renders this *over* the live view while the rower keeps
 * paddling out. On `session_end` the parent hands off to
 * `RacePostScreen`.
 *
 * The component renders pre-latched, immutable values; it does not
 * recompute when later strokes arrive.
 */
type Props = { result: RaceResultLatch }

function fmtMmSs(s: number): string {
  const sign = s < 0 ? '-' : ''
  const abs = Math.abs(s)
  const m = Math.floor(abs / 60)
  const r = Math.round(abs - m * 60)
  return `${sign}${m}:${String(r).padStart(2, '0')}`
}

function fmtSplit(s: number): string {
  // mm:ss.t — one decimal of seconds.
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}

function fmtGap(n: number): string {
  if (n === 0) return '0.0 s'
  const sign = n > 0 ? '+' : '-'
  return `${sign}${Math.abs(n).toFixed(1)} s`
}

export function FinishOverlay({ result }: Props) {
  const { finalTimeS, finalSplitS, gaps } = result
  return (
    <div className={styles.overlay} role="status" data-testid="finish-overlay">
      <div className={styles.header}>
        <h2 className={styles.title}>Ziel!</h2>
        <span className={styles.copy}>Paddelst aus...</span>
      </div>
      <div className={styles.row}>
        <div className={styles.cell}>
          <span className={styles.label}>Endzeit</span>
          <span className={styles.value} data-testid="finish-time">{fmtMmSs(finalTimeS)}</span>
        </div>
        <div className={styles.cell}>
          <span className={styles.label}>Split</span>
          <span className={styles.value} data-testid="finish-split">{fmtSplit(finalSplitS)}</span>
        </div>
        {gaps.ghost != null && (
          <div className={styles.cell}>
            <span className={styles.label}>vs. Ghost</span>
            <span
              className={`${styles.value} ${gaps.ghost <= 0 ? styles.gapAhead : styles.gapBehind}`}
              data-testid="finish-gap-ghost"
            >
              {fmtGap(gaps.ghost)}
            </span>
          </div>
        )}
        {gaps.pb != null && (
          <div className={styles.cell}>
            <span className={styles.label}>vs. PB</span>
            <span
              className={`${styles.value} ${gaps.pb <= 0 ? styles.gapAhead : styles.gapBehind}`}
              data-testid="finish-gap-pb"
            >
              {fmtGap(gaps.pb)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
