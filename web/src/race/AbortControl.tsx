import { useEffect, useRef, useState } from 'react'
import styles from './AbortControl.module.css'

/**
 * Top-right "Abbrechen" pill + confirmation sheet. Owned by `RaceFlow`
 * and rendered on Bereit, Ceremony, Live, Finished (absent on Post).
 *
 * The pill sits above the ceremony overlay (RaceStartSequence z-index
 * is 10; this host uses z-index 25) so it remains tappable mid-
 * countdown. Tapping the pill opens a confirmation sheet; the cancel
 * button closes the sheet without side effects, the confirm button
 * invokes `onConfirmAbort` (typically dispatches the reducer `abort`
 * event and routes the session-end as the existing X-abort path does).
 */
type Props = {
  onConfirmAbort: () => void
}

export function AbortControl({ onConfirmAbort }: Props) {
  const [open, setOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    sheetRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div
      className={styles.host}
      style={{ zIndex: 25 }}
      data-testid="abort-control"
    >
      <button
        type="button"
        className={styles.pill}
        onClick={() => setOpen(true)}
        data-testid="abort-pill"
        aria-label="Rennen abbrechen"
      >
        Abbrechen
      </button>
      {open && (
        <div
          className={styles.scrim}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
          data-testid="abort-confirm-scrim"
        >
          <section
            ref={sheetRef}
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="abort-confirm-title"
            tabIndex={-1}
            data-testid="abort-confirm-sheet"
          >
            <h2 id="abort-confirm-title" className={styles.title}>
              Rennen abbrechen?
            </h2>
            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.confirm}`}
                onClick={() => {
                  setOpen(false)
                  onConfirmAbort()
                }}
                data-testid="abort-confirm-confirm"
              >
                Rennen abbrechen
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.cancel}`}
                onClick={() => setOpen(false)}
                data-testid="abort-confirm-cancel"
              >
                Abbrechen
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
