import type { LiveState } from '../live/reducer'
import { fmtInt, fmtMeters, mmss, pace500m } from '../util/format'
import { StrokePulse } from './StrokePulse'
import styles from './LiveHero.module.css'

type Props = { state: LiveState }

export function LiveHero({ state }: Props) {
  const s = state.stroke
  return (
    <section className={styles.hero} aria-label="Live-Daten">
      <div className={styles.split}>
        <div className={styles.pulseAnchor}>
          <StrokePulse state={state} />
        </div>
        <span className={`label-sm ${styles.splitLabel}`}>Split</span>
        <div className={styles.splitRow}>
          <span className={`${styles.splitValue} tnum`}>
            {pace500m(s?.pace_sec_per_500m ?? null)}
          </span>
          <span className={styles.splitUnit}>/ 500m</span>
        </div>
      </div>
      <div className={styles.secondary}>
        <div className={styles.secondaryCell}>
          <span className={`label-sm ${styles.secondaryLabel}`}>Zeit</span>
          <span className={`${styles.secondaryValue} tnum`}>{mmss(s?.time_sec ?? null)}</span>
        </div>
        <div className={styles.secondaryCell}>
          <span className={`label-sm ${styles.secondaryLabel}`}>Distanz</span>
          <span className={`${styles.secondaryValue} tnum`}>
            {fmtMeters(s?.distance_m ?? null)}
          </span>
        </div>
        <div className={styles.secondaryCell}>
          <span className={`label-sm ${styles.secondaryLabel}`}>SPM</span>
          <span className={`${styles.secondaryValue} tnum`}>{fmtInt(s?.spm ?? null)}</span>
        </div>
        <div className={styles.secondaryCell}>
          <span className={`label-sm ${styles.secondaryLabel}`}>Watt</span>
          <span className={`${styles.secondaryValue} tnum`}>{fmtInt(s?.power_w ?? null)}</span>
        </div>
      </div>
    </section>
  )
}
