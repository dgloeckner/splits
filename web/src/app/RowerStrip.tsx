import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useRowers } from '../hooks/useRowers'
import { useActiveRower } from '../hooks/useActiveRower'
import { setActiveRower, ApiError } from '../api/rowers'
import styles from './RowerStrip.module.css'

export function RowerStrip() {
  const rowers = useRowers()
  const active = useActiveRower()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [pairingHint, setPairingHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function switchTo(id: string) {
    if (id === active.data?.id) return
    setPairingHint(null)
    setError(null)
    try {
      await setActiveRower(id)
      await qc.invalidateQueries({ queryKey: ['active-rower'] })
      await qc.invalidateQueries({ queryKey: ['sessions'] })
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPairingHint('Dieses Profil ist nicht mit diesem Gerät verbunden.')
        return
      }
      setError('Profilwechsel fehlgeschlagen.')
    }
  }

  if (!rowers.data) return <div className={styles.root} />
  return (
    <div>
      <div className={styles.root} role="toolbar" aria-label="Rudernde">
        {rowers.data.map((r) => (
          <button
            key={r.id}
            className={styles.avatar}
            data-active={active.data?.id === r.id}
            style={{ background: r.color }}
            aria-label={`Aktivieren: ${r.name}`}
            onClick={() => switchTo(r.id)}
          >
            {r.name.slice(0, 1).toUpperCase()}
          </button>
        ))}
        <button className={styles.add} aria-label="Rudernde hinzufügen" onClick={() => nav('/profil')}>
          +
        </button>
      </div>
      {pairingHint && (
        <div role="status" className={styles.hint}>
          {pairingHint}
        </div>
      )}
      {error && (
        <div role="alert" className={styles.hint}>
          {error}
        </div>
      )}
    </div>
  )
}
