import { useEffect, useRef } from 'react'
import styles from './AbortWorkoutDialog.module.css'

type Props = {
  open: boolean
  onSave: () => void
  onContinue: () => void
  onDiscard: () => void
}

export function AbortWorkoutDialog({ open, onSave, onContinue, onDiscard }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onContinue()
    }
    window.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onContinue])

  if (!open) return null

  return (
    <div
      className={styles.scrim}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onContinue()
      }}
      data-testid="abort-dialog-scrim"
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="abort-dialog-title"
        tabIndex={-1}
        data-testid="abort-dialog"
      >
        <div className={styles.header}>
          <h2 id="abort-dialog-title" className={styles.title}>
            Workout beenden?
          </h2>
          <p className={styles.body}>Deine Session wurde bereits aufgezeichnet.</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            onClick={onSave}
            data-testid="abort-dialog-save"
          >
            Session speichern
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.secondary}`}
            onClick={onContinue}
            data-testid="abort-dialog-continue"
          >
            Weiter rudern
          </button>
          <div className={styles.tertiaryRow}>
            <button
              type="button"
              className={styles.tertiary}
              onClick={onDiscard}
              data-testid="abort-dialog-discard"
            >
              Session verwerfen
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
