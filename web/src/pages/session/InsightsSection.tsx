import { useEffect, useState } from 'react'
import styles from './InsightsSection.module.css'
import { getSessionInsights, type Insights } from '../../api/insights'
import type { SessionSamples } from '../../api/client'
import { FindingCard } from './FindingCard'

const placeholderForReason: Record<string, string> = {
  intervals: 'Insights für Intervalle in Vorbereitung.',
  too_short: 'Session zu kurz für Auswertung.',
}

export function InsightsSection({ sessionId, samples }: { sessionId: string; samples?: SessionSamples | null }) {
  const [data, setData] = useState<Insights | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    getSessionInsights(sessionId)
      .then((r) => { if (!cancelled) setData(r) })
      .catch(() => { if (!cancelled) setErrored(true) })
    return () => { cancelled = true }
  }, [sessionId])

  if (errored || !data) return null

  if (data.findings.length === 0) {
    const msg = data.reason ? placeholderForReason[data.reason] : null
    if (!msg) return null
    return (
      <section className={styles.section}>
        <h2 className={styles.heading}>Auswertung</h2>
        <p className={styles.placeholder}>{msg}</p>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Auswertung</h2>
      <p className={styles.synthesis} data-testid="insights-synthesis">{data.synthesisDe}</p>
      <div className={styles.cards}>
        {data.findings.map((f) => (
          <FindingCard key={f.detector_id} finding={f} samples={samples} />
        ))}
      </div>
    </section>
  )
}
