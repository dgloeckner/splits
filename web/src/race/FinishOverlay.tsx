import type { RaceResultLatch } from './raceResultLatch'
import { fmtGap } from './fmtGap'
import { fmtMmSs, fmtMmSsTenths } from '../lib/formatDuration'
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
          <span className={styles.label}>Schnitt</span>
          <span className={styles.value} data-testid="finish-split">{fmtMmSsTenths(finalSplitS)}</span>
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
