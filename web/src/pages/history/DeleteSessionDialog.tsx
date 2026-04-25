import type { SessionRow } from '../../api/client'
import { fmtMeters, mmssWhole } from '../../util/format'
import { formatSessionStart } from '../../util/dates'
import styles from './DeleteSessionDialog.module.css'

type Props = {
  open: boolean
  session: SessionRow
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Confirmation dialog for the irreversible session-delete action
// (FEAT-0009 Mode 1). Shown from Historie cards and Session-Detail.
export function DeleteSessionDialog({ open, session, busy, onConfirm, onCancel }: Props) {
  if (!open) return null
  const km = (session.total_distance_m ?? 0) / 1000
  const summary = `${formatSessionStart(session.started_at)} · ${fmtMeters(
    session.total_distance_m ?? 0,
  )} m · ${mmssWhole(session.total_time_sec ?? 0)}${km >= 1 ? '' : ''}`
  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-labelledby="del-title">
      <div className={styles.card} data-testid="delete-session-dialog">
        <span className={styles.warnIcon} aria-hidden>
          ⚠
        </span>
        <h2 id="del-title" className={styles.title}>
          Sitzung unwiderruflich löschen?
        </h2>
        <p className={styles.summary}>{summary}</p>
        <p className={styles.warning}>
          Statistiken und Bestzeiten werden neu berechnet. Diese Aktion kann
          nicht rückgängig gemacht werden.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.danger}
            disabled={busy}
            onClick={onConfirm}
            data-testid="delete-session-confirm"
          >
            Löschen
          </button>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  )
}
