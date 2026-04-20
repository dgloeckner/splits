import { useEffect, useState } from 'react'
import type { LiveState } from '../live/reducer'
import styles from './StrokePulse.module.css'

type Props = { state: LiveState }

export function StrokePulse({ state }: Props) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!state.lastStrokeReceivedAtMs) return
    setActive(true)
    const t = setTimeout(() => setActive(false), 80)
    return () => clearTimeout(t)
  }, [state.lastStrokeReceivedAtMs])

  const stale =
    state.lastStrokeReceivedAtMs !== null &&
    Date.now() - state.lastStrokeReceivedAtMs > 3000

  const statusLabel = (() => {
    if (state.status === 'open' && state.stroke) return 'Live'
    if (state.status === 'open' && !state.stroke) return 'Wartet auf Ergo'
    if (state.status === 'connecting') return 'Verbindet …'
    if (state.status === 'error') return 'Keine Verbindung'
    return '—'
  })()

  return (
    <span className={styles.pulse} aria-live="polite">
      <span
        className={`${styles.dot} ${active && !stale ? styles.dotActive : ''}`}
        aria-hidden="true"
      />
      {statusLabel}
    </span>
  )
}
