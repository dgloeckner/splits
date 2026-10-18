import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { pair } from '../api/pairing'
import { ApiError } from '../api/error'
import styles from './PairPage.module.css'

type Status = 'pending' | 'malformed' | 'stale' | 'error' | 'success'

function readToken(hash: string): string | null {
  if (!hash.startsWith('#t=')) return null
  const token = hash.slice(3)
  return token || null
}

export function PairPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const location = useLocation()
  const tok = readToken(location.hash)
  const [pairStatus, setStatus] = useState<Status>('pending')
  // A link without a token never reaches the server.
  const status: Status = tok ? pairStatus : 'malformed'

  useEffect(() => {
    if (!tok) return
    pair(tok)
      .then(async () => {
        // Clear the fragment from URL + history.
        window.history.replaceState(null, '', '/')
        await qc.invalidateQueries({ queryKey: ['rowers'] })
        await qc.invalidateQueries({ queryKey: ['active-rower'] })
        setStatus('success')
        nav('/', { replace: true })
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 410) {
          setStatus('stale')
        } else {
          setStatus('error')
        }
      })
  }, [nav, qc, tok])

  return (
    <main className={styles.page}>
      <div className={styles.card} role="status" aria-live="polite">
        {status === 'pending' && (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            <p className={styles.title}>Wird verbunden …</p>
            <p className={styles.body}>Einen Moment bitte.</p>
          </>
        )}
        {status === 'malformed' && (
          <>
            <p className={styles.title}>Pairing-Link ungültig</p>
            <p className={styles.body}>
              Der geöffnete Link enthält keinen gültigen Pairing-Token. Frag im
              Haushalt nach einem neuen.
            </p>
            <Link to="/" className={styles.cta}>Zurück</Link>
          </>
        )}
        {status === 'stale' && (
          <>
            <p className={styles.title}>Code nicht mehr gültig</p>
            <p className={styles.body}>
              Der Pairing-Link ist abgelaufen oder wurde bereits verwendet.
              Frag im Haushalt nach einem neuen.
            </p>
            <Link to="/" className={styles.cta}>Zurück</Link>
          </>
        )}
        {status === 'error' && (
          <>
            <p className={styles.title}>Verbindung fehlgeschlagen</p>
            <p className={styles.body}>
              Konnte mit dem Server nicht reden. Prüf die Wi-Fi-Verbindung
              und versuche es erneut.
            </p>
            <Link to="/pair" className={styles.cta}>Erneut versuchen</Link>
          </>
        )}
        {/* status==='success' is intentionally a blank flash — we are
            already navigating away in the effect above. */}
      </div>
    </main>
  )
}
