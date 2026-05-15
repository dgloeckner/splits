import type { SessionEndSummary } from '../../live/events'
import { fmtInt, fmtMeters, mmssWhole, pace500m } from '../../util/format'
import type { BannerState } from './usePBBanners'
import styles from './SessionEndedOverlay.module.css'

type Props = {
  summary: SessionEndSummary
  banners: BannerState
  /** Close the overlay and return to home. Bound to the "Fertig"
   *  secondary action — and, when no session id is available, also
   *  to the primary slot since there is nothing to show. */
  onAcknowledge: () => void
  /** Navigate to the session detail. When provided, this becomes the
   *  primary action — rowers almost always want to inspect the run
   *  they just finished, not start a new one. */
  onShowDetails?: () => void
}

// U4: the primary action on this screen used to be "Neue Session
// starten" with subtitle "Bereit für eine neue Runde?", which is the
// wrong default for rowers — they don't typically jump straight onto
// another workout after a 5K + cool-down. The PB-computing subtitle is
// retained while banners are still resolving (the only useful
// status message at this moment).
export function SessionEndedOverlay({ summary, banners, onAcknowledge, onShowDetails }: Props) {
  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-labelledby="ended-title">
      <section className={styles.card} data-testid="session-ended-overlay">
        <div className={styles.header}>
          <h2 id="ended-title" className={styles.title}>
            Session beendet
          </h2>
          {banners.kind === 'computing' && (
            <p className={styles.subtitle}>Bestleistungen werden berechnet …</p>
          )}
        </div>
        <div className={styles.metrics}>
          {/* F5: while banners.kind === 'computing' the summary numbers
            * have not been backfilled yet — they arrive as zeros and
            * read as "your session was empty." Show "—" placeholders
            * until real values are available. */}
          {banners.kind === 'computing' ? (
            <>
              <Cell label="Distanz" value="—" />
              <Cell label="Zeit" value="—" />
              <Cell label="Ø Split" value="—" />
              <Cell label="Schläge" value="—" />
            </>
          ) : (
            <>
              <Cell label="Distanz" value={`${fmtMeters(summary.total_distance_m)} m`} />
              <Cell label="Zeit" value={mmssWhole(summary.total_time_sec)} />
              <Cell label="Ø Split" value={pace500m(summary.avg_pace_sec_per_500m)} />
              <Cell label="Schläge" value={fmtInt(summary.total_strokes)} />
            </>
          )}
        </div>
        <div className={styles.actions}>
          {onShowDetails ? (
            <>
              <button
                type="button"
                className={styles.primary}
                onClick={onShowDetails}
                data-testid="session-ended-details"
              >
                Details ansehen
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={onAcknowledge}
                data-testid="session-ended-ok"
              >
                Fertig
              </button>
            </>
          ) : (
            // No session id to show details for → primary slot is the
            // close action, kept clearly named so users don't think
            // they're starting another workout.
            <button
              type="button"
              className={styles.primary}
              onClick={onAcknowledge}
              data-testid="session-ended-ok"
            >
              Fertig
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
