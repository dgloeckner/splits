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

  const finalize = useMutation({
    mutationFn: finalizeSession,
    onSuccess: invalidate,
  })
  const discard = useMutation({
    mutationFn: deleteSession,
    onSuccess: invalidate,
  })

  const sessions = data ?? []
  if (!rowerID || sessions.length === 0) return null

  return (
    <section className={styles.card} data-testid="stale-open-recovery-card">
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
    </section>
  )
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
