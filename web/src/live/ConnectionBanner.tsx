import { useLiveSession } from './LiveSessionContext'
import styles from './ConnectionBanner.module.css'

/**
 * Non-blocking banner shown on the Live page when the SSE channel has
 * exhausted its automatic reconnect attempts. Offers a manual retry
 * button. Hidden during normal operation, including transient
 * `reconnecting` states (which the user shouldn't notice).
 */
export function ConnectionBanner() {
  const { status, reconnect } = useLiveSession()
  if (status !== 'permanently_disconnected') return null
  return (
    <div className={styles.banner} role="alert">
      <span className={styles.text}>Verbindung verloren.</span>
      <button type="button" className={styles.btn} onClick={() => reconnect?.()}>
        Erneut verbinden
      </button>
    </div>
  )
}
