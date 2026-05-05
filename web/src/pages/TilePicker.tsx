import { Sheet } from '../components/Sheet/Sheet'
import { TILES, getTile } from '../tiles/registry'
import styles from './TilePicker.module.css'

type Props = {
  open: boolean
  slotIndex: number
  currentTileId: string
  onSelect: (slotIndex: number, tileId: string) => void
  onClose: () => void
}

const TYPE_LABEL: Record<string, string> = {
  numeric: 'Zahl',
  sparkline: 'Verlauf',
  zone: 'Bewertung',
  'race-boat': 'Rennen',
}

export function TilePicker({ open, slotIndex, currentTileId, onSelect, onClose }: Props) {
  const current = getTile(currentTileId)
  const typeOrder = ['numeric', 'sparkline', 'zone', 'race-boat'] as const
  const ordered = typeOrder.flatMap((t) => TILES.filter((tile) => tile.type === t))

  return (
    <Sheet open={open} onClose={onClose} title="Metrik wählen">
      {current && (
        <div className={styles.currentBanner}>
          <span className="label-sm">Aktuelle Auswahl</span>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-title-md)' }}>
            {current.label}
          </div>
        </div>
      )}
      <div className={styles.list}>
        {ordered.map((tile) => {
          const disabled = tile.gated === 'hr'
          return (
            <button
              key={tile.id}
              className={styles.entry}
              disabled={disabled}
              onClick={() => {
                onSelect(slotIndex, tile.id)
                onClose()
              }}
              aria-label={`${tile.label}${disabled ? ' (nicht verfügbar)' : ''}`}
            >
              <div className={styles.entryMain}>
                <span className={styles.entryLabel}>{tile.label}</span>
                {tile.subtitle && <span className={styles.entrySubtitle}>{tile.subtitle}</span>}
              </div>
              <span className={styles.entryType}>{TYPE_LABEL[tile.type]}</span>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
