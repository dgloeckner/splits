import styles from './FindingCard.module.css'
import type { Finding } from '../../api/insights'
import type { SessionSamples } from '../../api/client'
import { findingVisual } from './findingVisuals'
import { FindingSparkline } from './FindingSparkline'

const categoryLabel: Record<Finding['category'], string> = {
  PACING: 'Pacing',
  EFFICIENCY: 'Leistung',
  CONSISTENCY: 'Tempokonstanz',
}

/**
 * Evidence card for one finding: label, key number and a sparkline of
 * the slice it rests on. The sentence lives in the synthesis paragraph
 * above the cards, never on the card (#40).
 */
export function FindingCard({ finding, samples }: { finding: Finding; samples?: SessionSamples | null }) {
  const v = findingVisual(finding, samples)
  return (
    <div
      className={styles.card}
      data-testid="finding-card"
      data-severity={finding.severity}
      data-category={finding.category}
      data-code={finding.code}
    >
      <div className={styles.text}>
        <span className={styles.label}>{v.label ?? categoryLabel[finding.category]}</span>
        <span className={styles.headline} data-testid="finding-headline">{v.headline}</span>
        {v.tag && <span className={styles.tag}>{v.tag}</span>}
      </div>
      {v.spark && <FindingSparkline spec={v.spark} />}
    </div>
  )
}
