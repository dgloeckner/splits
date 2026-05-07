import { useState } from 'react'
import { Sheet } from '../../components/Sheet/Sheet'
import styles from './OpponentPickerSheet.module.css'

type Selection = { ghost: boolean; pb: boolean }

type Props = {
  open: boolean
  meters: number
  hasGhost: boolean
  hasPB: boolean
  onConfirm: (sel: Selection) => void
  onClose: () => void
}

export function OpponentPickerSheet({
  open,
  meters,
  hasGhost,
  hasPB,
  onConfirm,
  onClose,
}: Props) {
  const [sel, setSel] = useState<Selection>({ ghost: true, pb: hasPB })
  return (
    <Sheet open={open} onClose={onClose} title={`${meters} m Rennen`}>
      <div className={styles.list}>
        <label className={styles.row}>
          <input
            type="checkbox"
            data-testid="opt-ghost"
            checked={sel.ghost}
            onChange={(e) => setSel({ ...sel, ghost: e.target.checked })}
          />
          <span className={styles.label}>
            {hasGhost ? 'Geist (letzte Session)' : 'Synthetischer Geist nach Härte'}
          </span>
        </label>
        {hasPB && (
          <label className={styles.row}>
            <input
              type="checkbox"
              data-testid="opt-pb"
              checked={sel.pb}
              onChange={(e) => setSel({ ...sel, pb: e.target.checked })}
            />
            <span className={styles.label}>Bestzeit</span>
          </label>
        )}
      </div>
      <button type="button" className={styles.confirm} onClick={() => onConfirm(sel)}>
        Rennen starten
      </button>
    </Sheet>
  )
}
