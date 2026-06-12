import type { TrendsWindowKey } from '../../api/client'
import styles from './WindowTabs.module.css'

const LABELS: Record<TrendsWindowKey, string> = { '30d': 'Monat', '365d': 'Jahr', all: 'Alles' }
const ORDER: TrendsWindowKey[] = ['30d', '365d', 'all']

export function WindowTabs({ value, onChange }: { value: TrendsWindowKey; onChange: (w: TrendsWindowKey) => void }) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Zeitraum">
      {ORDER.map((w) => (
        <button key={w} type="button" role="tab" aria-selected={value === w}
          className={value === w ? `${styles.tab} ${styles.active}` : styles.tab}
          onClick={() => onChange(w)}>
          {LABELS[w]}
        </button>
      ))}
    </div>
  )
}
