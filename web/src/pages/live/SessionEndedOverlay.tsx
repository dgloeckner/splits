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
        <BannersStrip banners={banners} />
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

function BannersStrip({ banners }: { banners: BannerState }) {
  if (banners.kind === 'idle') return null
  if (banners.kind === 'computing') {
    return (
      <div className={styles.bannersStrip} data-testid="pb-banners-computing">
        <div className={styles.bannerSkeleton} />
        <div className={styles.bannerSkeleton} />
        <div className={styles.bannerSkeleton} />
      </div>
    )
  }
  const list = banners.kind === 'resolved' ? banners.banners : { distance: [], window: [] }
  if (list.distance.length === 0 && list.window.length === 0) return null
  return (
    <div className={styles.bannersStrip} data-testid="pb-banners-resolved">
      {list.distance.map((d) => (
        <span key={`d-${d.distance_m}`} className={styles.banner}>
          🏆 Neue Bestzeit · {d.distance_m / 1000} km · {mmssWhole(d.time_sec)}
        </span>
      ))}
      {list.window.map((w) => (
        <span key={`w-${w.metric}-${w.window_size}`} className={styles.banner}>
          🏆 Bestleistung · {windowLabel(w.metric, w.window_kind, w.window_size)}
        </span>
      ))}
    </div>
  )
}

function windowLabel(metric: string, kind: string, size: number): string {
  const window = kind === 'seconds' ? `${size} s` : `${size} Schläge`
  switch (metric) {
    case 'power':
      return `Power ${window}`
    case 'pace':
      return `Pace ${window}`
    case 'dps':
      return `DPS ${window}`
    case 'spi':
      return `SPI ${window}`
    default:
      return `${metric} ${window}`
  }
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.cell}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  )
}
