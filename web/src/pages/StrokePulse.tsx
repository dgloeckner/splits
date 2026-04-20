import { useEffect, useRef, useState } from 'react'
import type { LiveState } from '../live/reducer'
import styles from './StrokePulse.module.css'

type Props = { state: LiveState }

export function StrokePulse({ state }: Props) {
  const [active, setActive] = useState(false)
  const [stale, setStale] = useState(false)
  const prevStrokeAtRef = useRef<number | null>(null)

  useEffect(() => {
    const at = state.lastStrokeReceivedAtMs
    if (at === null || at === prevStrokeAtRef.current) return
    prevStrokeAtRef.current = at
    setActive(true)
    setStale(false)
    const pulseT = setTimeout(() => setActive(false), 80)
    const staleT = setTimeout(() => setStale(true), 3000)
    return () => {
      clearTimeout(pulseT)
      clearTimeout(staleT)
    }
  }, [state.lastStrokeReceivedAtMs])

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
