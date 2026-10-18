import { useQuery } from '@tanstack/react-query'
import { getUpdateStatus, type UpdateState, type UpdateStatus } from '../../api/updateStatus'
import { formatStand } from '../../util/dates'
import styles from './UpdateStatusCard.module.css'

type Copy = { title: string; detail?: string; tone: 'normal' | 'info' | 'warn' | 'muted' }

// FEAT-0016 UX table. *Behind* is the normal state of every Pi between a
// Release and the next 04:30 run — informational, never an alarm — and
// must not look like *stuck*, which is the one state somebody should act on.
function updateStatusCopy(s: UpdateStatus | undefined): Copy & { state: UpdateState } {
  const state: UpdateState = s?.state ?? 'unknown'
  const installed = s?.installed || s?.running || ''
  switch (state) {
    case 'current':
      return {
        state,
        title: `Installiert ${installed} · aktuell`,
        detail: s?.checked_at ? `Zuletzt geprüft ${formatStand(s.checked_at)}` : undefined,
        tone: 'normal',
      }
    case 'behind':
      return {
        state,
        title: `Installiert ${installed}`,
        detail: `Neu: ${s?.latest} — wird heute Nacht installiert`,
        tone: 'info',
      }
    case 'stuck':
      return {
        state,
        title: `Update auf ${s?.latest} fehlgeschlagen — läuft weiter auf ${installed}`,
        detail: 'Wird erst mit einer neueren Version wieder versucht.',
        tone: 'warn',
      }
    case 'off':
      return {
        state,
        title: 'Automatische Updates aus',
        detail: installed ? `Installiert ${installed}` : undefined,
        tone: 'muted',
      }
    default: {
      let detail: string | undefined
      if (s?.result === 'hand-managed') detail = 'Manuell verwaltete Installation'
      else if (s?.running && s.running !== 'dev') detail = `Läuft ${s.running}`
      return { state: 'unknown', title: 'Update-Status unbekannt', detail, tone: 'muted' }
    }
  }
}

/** Profil „Updates" block (ADR-0023 §4): what runs on the Pi, and whether
 *  an update is pending or failed. Read-only; the updater is a root timer. */
export function UpdateStatusCard() {
  const q = useQuery({
    queryKey: ['update-status'],
    queryFn: getUpdateStatus,
    staleTime: 60_000,
  })
  if (q.isPending) return null
  // Offline or unreachable: say so plainly instead of guessing.
  const copy = updateStatusCopy(q.isError ? undefined : q.data)
  return (
    <div
      className={`${styles.card} ${styles[copy.tone]}`}
      data-testid="update-status"
      data-state={copy.state}
    >
      <span className={styles.title} data-testid="update-status-title">
        {copy.title}
      </span>
      {copy.detail && (
        <span className={styles.detail} data-testid="update-status-detail">
          {copy.detail}
        </span>
      )}
    </div>
  )
}
