import { useLiveSession } from './LiveSessionContext'
import { useDeviceStatus } from './useDeviceStatus'
import styles from './ConnectionBanner.module.css'

/**
 * Two-tier banner on the Live page:
 *   - red    "Verbindung verloren"        — SSE channel exhausted retries
 *   - yellow "Rudergerät nicht verbunden" — IPM serial offline
 * SSE issue takes precedence (no point telling the user about device
 * state we can no longer get updates on). Hidden during normal
 * operation, including transient SSE reconnects.
 */
export function ConnectionBanner() {
  const { status, reconnect } = useLiveSession()
  const device = useDeviceStatus()

  if (status === 'permanently_disconnected') {
    return (
      <div className={`${styles.banner} ${styles.error}`} role="alert">
        <span className={styles.text}>Verbindung verloren.</span>
        <button type="button" className={styles.btn} onClick={() => reconnect?.()}>
          Erneut verbinden
        </button>
      </div>
    )
  }

  if (!device.connected) {
    return (
      <div className={`${styles.banner} ${styles.warn}`} role="status" data-testid="device-banner">
        <span className={styles.text}>Rudergerät nicht verbunden.</span>
      </div>
    )
  }

  return null
}
