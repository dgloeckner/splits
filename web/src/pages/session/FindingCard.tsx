import styles from './FindingCard.module.css'
import type { Finding } from '../../api/insights'

const categoryLabel: Record<Finding['category'], string> = {
  PACING: 'Pacing',
  EFFICIENCY: 'Leistung',
  CONSISTENCY: 'Tempokonstanz',
}

export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div
      className={styles.card}
      data-testid="finding-card"
      data-severity={finding.severity}
      data-category={finding.category}
    >
      <span className={styles.label}>{categoryLabel[finding.category]}</span>
      <p className={styles.message}>{finding.message_de}</p>
    </div>
  )
}
