import type { SessionEndSummary } from '../../live/events'
import { fmtInt, fmtMeters, mmssWhole, pace500m } from '../../util/format'
import type { BannerState } from './usePBBanners'
import styles from './SessionEndedOverlay.module.css'

type Props = {
  summary: SessionEndSummary
  banners: BannerState
  onAcknowledge: () => void
  onShowDetails?: () => void
}

export function SessionEndedOverlay({ summary, banners, onAcknowledge, onShowDetails }: Props) {
  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-labelledby="ended-title">
      <section className={styles.card} data-testid="session-ended-overlay">
        <div className={styles.header}>
          <h2 id="ended-title" className={styles.title}>
            Session beendet
          </h2>
          <p className={styles.subtitle}>
            {banners.kind === 'computing'
              ? 'Bestleistungen werden berechnet …'
              : 'Bereit für eine neue Runde?'}
          </p>
        </div>
        <div className={styles.metrics}>
          <Cell label="Distanz" value={`${fmtMeters(summary.total_distance_m)} m`} />
          <Cell label="Zeit" value={mmssWhole(summary.total_time_sec)} />
          <Cell label="Ø Split" value={pace500m(summary.avg_pace_sec_per_500m)} />
          <Cell label="Schläge" value={fmtInt(summary.total_strokes)} />
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={onAcknowledge}
            data-testid="session-ended-ok"
          >
            Neue Session starten
          </button>
          {onShowDetails && (
            <button
              type="button"
              className={styles.secondary}
              onClick={onShowDetails}
              data-testid="session-ended-details"
            >
              Details ansehen
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.cell}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  )
}
