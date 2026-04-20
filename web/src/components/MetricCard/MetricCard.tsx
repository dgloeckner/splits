import styles from './MetricCard.module.css'

type Props = {
  label: string
  value: string | number | null
  unit?: string
  size?: 'sm' | 'md' | 'lg'
}

export function MetricCard({ label, value, unit, size = 'md' }: Props) {
  const displayValue = value === null || value === undefined ? '—' : String(value)
  return (
    <div className={`${styles.card} ${styles[size]}`}>
      <span className={`${styles.label} label-sm`}>{label}</span>
      <div className={styles.valueRow}>
        <span className={`${styles.value} tnum`}>{displayValue}</span>
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
    </div>
  )
}
