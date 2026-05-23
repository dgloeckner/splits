import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  deleteSession,
  finalizeSession,
  listStaleOpenSessions,
  type StaleOpenSession,
} from '../../api/client'
import styles from './StaleSessionCard.module.css'

export type Props = { rowerID?: string }

// StaleSessionCard surfaces the "Frühere Session abschließen?" prompt
// for `status='stale-open'` sessions belonging to the active rower.
// FEAT-0015 Slice 3 / ADR-0010.
export function StaleSessionCard({ rowerID }: Props) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const queryKey = ['sessions', 'stale-open', rowerID ?? '']
  const { data } = useQuery({
    queryKey,
    queryFn: () => listStaleOpenSessions(rowerID as string),
    enabled: !!rowerID,
    staleTime: 30_000,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey })
    // Stale-open finalising creates a real history row + may move PBs.
    qc.invalidateQueries({ queryKey: ['sessions'] })
  }

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const finalize = useMutation({
    mutationFn: finalizeSession,
    onSuccess: () => {
      setErrorMsg(null)
      invalidate()
    },
    onError: (e: unknown) => setErrorMsg(errorText(e, 'Beenden')),
  })
  const discard = useMutation({
    mutationFn: deleteSession,
    onSuccess: () => {
      setErrorMsg(null)
      invalidate()
    },
    onError: (e: unknown) => setErrorMsg(errorText(e, 'Verwerfen')),
  })

  const sessions = data ?? []
  const cardRef = useRef<HTMLElement | null>(null)
  // 0019-09: on mount, scroll the card's bottom into view inside
  // AppLayout.main (the scroll container). The card is the last child
  // on Home and, on tall short-viewport devices (390x844), its
  // Discard button can sit a few px under the persistent BottomNav.
  // AppLayout.main reserves --layout-bottom-reserved of scroll space
  // at the end of its scrollable region; aligning the card to that
  // visible bottom guarantees the action row clears the nav.
  useEffect(() => {
    if (sessions.length === 0) return
    const el = cardRef.current
    if (!el || typeof el.scrollIntoView !== 'function') return
    el.scrollIntoView({ block: 'end', behavior: 'auto' })
  }, [sessions.length])

  if (!rowerID || sessions.length === 0) return null

  return (
    <section ref={cardRef} className={styles.card} data-testid="stale-open-recovery-card">
      <h2 className={styles.heading}>Frühere Session abschließen?</h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {sessions.map((s) => (
          <StaleSessionRow
            key={s.id}
            session={s}
            onFinalize={() => finalize.mutate(s.id)}
            onDiscard={() => discard.mutate(s.id)}
            onResume={() => nav('/live')}
            busy={finalize.isPending || discard.isPending}
          />
        ))}
      </ul>
      {errorMsg && (
        <p
          role="alert"
          data-testid="stale-recovery-error"
          style={{ color: 'var(--color-danger, #c0392b)', margin: '8px 0 0' }}
        >
          {errorMsg}
        </p>
      )}
    </section>
  )
}

function errorText(e: unknown, action: string): string {
  const status =
    e && typeof e === 'object' && 'status' in e && typeof (e as { status?: unknown }).status === 'number'
      ? (e as { status: number }).status
      : null
  if (status === 409) return `${action} fehlgeschlagen: Session ist noch aktiv. Bitte App neu starten.`
  if (status === 404) return `Session existiert nicht mehr (bereits ${action.toLowerCase()}).`
  return `${action} fehlgeschlagen. Bitte erneut versuchen.`
}

type RowProps = {
  session: StaleOpenSession
  onFinalize: () => void
  onDiscard: () => void
  onResume: () => void
  busy: boolean
}

function StaleSessionRow({ session, onFinalize, onDiscard, onResume, busy }: RowProps) {
  const km = (session.total_distance_m / 1000).toFixed(2)
  // ADR-0012: race-mode sessions are non-resumable. The recovery card
  // for race rows exposes only Finalize and Discard; "Weiter rudern"
  // (rejoin live) is omitted entirely.
  const isRace = session.mode === 'race'
  return (
    <li>
      <p className={styles.summary}>
        {km} km · gestartet {formatDate(session.started_at)}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={onFinalize}
          disabled={busy}
          data-testid="stale-recovery-finalize"
        >
          Beenden mit gerudertem Stand
        </button>
        {!isRace && (
          <button
            type="button"
            className={styles.secondary}
            onClick={onResume}
            disabled={busy}
            data-testid="stale-recovery-rejoin"
          >
            Weiter rudern
          </button>
        )}
        <button
          type="button"
          className={styles.danger}
          onClick={onDiscard}
          disabled={busy}
          data-testid="stale-recovery-discard"
        >
          Verwerfen
        </button>
      </div>
    </li>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}
