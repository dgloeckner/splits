import { useNavigate } from 'react-router-dom'
import { useLiveSession } from './LiveSessionContext'
import { enterOfflineMode } from '../offline/reachability'
import styles from './ConnectionBanner.module.css'

/**
 * Two-tier banner on the Live page:
 *   - red    "Verbindung verloren"        — SSE channel exhausted retries
 *   - yellow "Rudergerät nicht verbunden" — IPM serial offline
 * SSE issue takes precedence (no point reporting device state we can
 * no longer get push updates on). Hidden during normal operation,
 * including transient SSE reconnects.
 *
 * Device connectivity comes from the `device` SSE event pushed by the
 * backend's DeviceMonitor; no polling.
 */
export function ConnectionBanner() {
  const { status, reconnect, deviceConnected } = useLiveSession()
  const nav = useNavigate()

  if (status === 'permanently_disconnected') {
    return (
      <div className={`${styles.banner} ${styles.error}`} role="alert">
        <span className={styles.text}>Verbindung verloren.</span>
        <button type="button" className={styles.btn} onClick={() => reconnect?.()}>
          Erneut verbinden
        </button>
        {/* ADR-0021 §4: continue with the local snapshot instead. */}
        <button
          type="button"
          className={styles.btn}
          onClick={() => {
            enterOfflineMode()
            nav('/')
          }}
        >
          Offline-Modus
        </button>
      </div>
    )
  }

  if (deviceConnected === false) {
    return (
      <div className={`${styles.banner} ${styles.warn}`} role="status" data-testid="device-banner">
        <span className={styles.text}>Rudergerät nicht verbunden.</span>
      </div>
    )
  }

  return null
}
