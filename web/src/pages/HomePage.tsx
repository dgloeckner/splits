import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { startSession } from '../api/client'
import { useActiveRower } from '../hooks/useActiveRower'
import { FavoritesList } from './home/FavoritesList'
import styles from './HomePage.module.css'

export function HomePage() {
  const nav = useNavigate()
  const active = useActiveRower()
  const rowerID = active.data?.id
  const [busy, setBusy] = useState(false)

  // "Nur rudern" is the quick-start workout: no parameterised
  // workout, just open a session and go to /live.
  async function startJustRow() {
    if (busy) return
    setBusy(true)
    try {
      await startSession()
      nav('/live')
    } catch {
      setBusy(false)
    }
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Home</h1>
      <section className={styles.tiles}>
        <button
          type="button"
          className={styles.tilePrimary}
          onClick={startJustRow}
          disabled={busy}
        >
          <span className={styles.tileLabel}>Nur rudern</span>
          <span className={styles.tileHint}>Schnellstart</span>
        </button>
        <button type="button" className={styles.tileSecondary} onClick={() => nav('/workout/new')}>
          <span className={styles.tileLabel}>Neues Workout</span>
          <span className={styles.tileHint}>Distanz · Zeit · Intervalle</span>
        </button>
      </section>
      {rowerID && <FavoritesList rowerID={rowerID} />}
    </main>
  )
}
