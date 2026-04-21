import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useRowers } from '../hooks/useRowers'
import { useActiveRower } from '../hooks/useActiveRower'
import { setActiveRower } from '../api/rowers'
import styles from './RowerStrip.module.css'

export function RowerStrip() {
  const rowers = useRowers()
  const active = useActiveRower()
  const qc = useQueryClient()
  const nav = useNavigate()

  async function switchTo(id: string) {
    if (id === active.data?.id) return
    await setActiveRower(id)
    await qc.invalidateQueries({ queryKey: ['active-rower'] })
    await qc.invalidateQueries({ queryKey: ['sessions'] })
  }

  if (!rowers.data) return <div className={styles.root} />
  return (
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
  )
}
