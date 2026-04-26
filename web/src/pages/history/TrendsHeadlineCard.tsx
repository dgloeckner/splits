import type { TrendsResponse } from '../../api/client'
import { hhmm, signedPct } from '../../util/format'
import styles from './TrendsTab.module.css'

type Props = {
  data: TrendsResponse
}

export function TrendsHeadlineCard({ data }: Props) {
  const km = data.totals.distance_m / 1000
  const showDelta = data.range !== 'all' && !!data.prior && data.prior.distance_m > 0
  const deltaFraction = showDelta
    ? (data.totals.distance_m - data.prior!.distance_m) / data.prior!.distance_m
    : 0
  const up = deltaFraction >= 0
  return (
    <section className={styles.headline} aria-label="Zusammenfassung">
      <p className={styles.periodLabel}>{data.period.label}</p>
      <div className={styles.headlineRow}>
        <h2 className={styles.headlineNum}>
          {km.toFixed(km < 10 ? 1 : 0)} <small>km</small>
        </h2>
        {showDelta && (
          <span
            className={`${styles.deltaChip} ${up ? styles.deltaUp : styles.deltaDown}`}
            data-testid="headline-delta"
          >
            <span aria-hidden>{up ? '↑' : '↓'}</span>
            {signedPct(deltaFraction)}
          </span>
        )}
      </div>
      <div className={styles.subRow}>
        <span>Dauer {hhmm(data.totals.active_sec)}</span>
        <span>Sessions {data.totals.sessions}</span>
      </div>
    </section>
  )
}
