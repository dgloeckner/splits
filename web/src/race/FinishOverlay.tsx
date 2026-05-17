import type { RaceResultLatch } from './raceResultLatch'
import { fmtGap } from './fmtGap'
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
type Props = {
  result: RaceResultLatch
  /**
   * 0019-03: explicit Fertig affordance. When provided, the rendered
   * Fertig button invokes this callback on tap. The parent is
   * responsible for firing `session_end` via the existing
   * `endSessionQueue` path and dismissing the race surface. If
   * omitted, the button still renders (and is enabled) but tapping it
   * is a no-op — the idle-timeout `session_end` path remains the
   * passive fallback.
   */
  onFinish?: () => void
}

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

export function FinishOverlay({ result, onFinish }: Props) {
  const { finalTimeS, finalSplitS, gaps } = result
  return (
    <div className={styles.overlay} role="status" data-testid="finish-overlay">
      <div className={styles.header}>
        <h2 className={styles.title}>Ziel!</h2>
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
      <button
        type="button"
        className={styles.fertig}
        data-testid="finish-fertig"
        onClick={() => onFinish?.()}
      >
        Fertig
      </button>
    </div>
  )
}
