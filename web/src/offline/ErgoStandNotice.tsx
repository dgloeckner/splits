import { Link } from 'react-router-dom'
import { formatStand } from '../util/dates'
import { useErgoStatus } from './ergoStatus'
import { retryReachabilityNow } from './reachability'
import styles from './ErgoStandNotice.module.css'

export function ErgoStandNotice({ variant }: { variant: 'banner' | 'hero' }) {
  const { reachable, packedAt } = useErgoStatus()
  if (reachable !== false) return null

  if (variant === 'banner') {
    return (
      <p className={styles.banner} data-testid="ergo-stand-banner" role="status">
        Ergo nicht erreichbar{packedAt ? ` · Stand: ${formatStand(packedAt)}` : ''}
      </p>
    )
  }
  return (
    <section className={styles.hero} data-testid="ergo-offline-hero">
      <p className={styles.heroTitle}>Ergo nicht erreichbar</p>
      {packedAt && <p className={styles.heroStand}>Stand: {formatStand(packedAt)}</p>}
      <Link to="/historie" className={styles.heroCta} data-testid="ergo-offline-cta">
        → Verlauf ansehen
      </Link>
      <button
        type="button"
        className={styles.heroRetry}
        data-testid="ergo-reconnect"
        onClick={() => retryReachabilityNow()}
      >
        Erneut verbinden
      </button>
    </section>
  )
}
