import { useEffect, type ReactNode } from 'react'
import { IconClose } from '../../icons'
import styles from './Sheet.module.css'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function Sheet({ open, onClose, title, children }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={styles.backdrop}
      data-testid="sheet-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="sheet-title" className={styles.title}>
            {title}
          </h2>
          <button className={styles.close} onClick={onClose} aria-label="Schließen">
            <IconClose />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
