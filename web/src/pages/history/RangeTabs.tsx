import type { TrendsRange } from '../../api/client'
import styles from './RangeTabs.module.css'

const LABELS: Record<TrendsRange, string> = {
  week: 'Woche',
  month: 'Monat',
  year: 'Jahr',
  all: 'Alles',
}

const ORDER: TrendsRange[] = ['week', 'month', 'year', 'all']

type Props = {
  value: TrendsRange
  onChange: (next: TrendsRange) => void
}

export function RangeTabs({ value, onChange }: Props) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Zeitraum">
      {ORDER.map((r) => (
        <button
          key={r}
          type="button"
          role="tab"
          aria-selected={value === r}
          className={value === r ? `${styles.tab} ${styles.active}` : styles.tab}
          onClick={() => onChange(r)}
        >
          {LABELS[r]}
        </button>
      ))}
    </div>
  )
}
