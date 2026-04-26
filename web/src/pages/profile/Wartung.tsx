import { useQueries, useQuery } from '@tanstack/react-query'
import {
  getRowerLifetime,
  listSessions,
  type RowerLifetime,
} from '../../api/client'
import styles from './Wartung.module.css'

type Props = { rowerID: string }

// Footprint heuristic: ~1.2 KB per session row (summary_json is the heaviest
// field). Strokes are ephemeral, so 0 contribution.
export function Wartung({ rowerID }: Props) {
  const lifetimeQ = useQuery<RowerLifetime>({
    queryKey: ['rower-lifetime', rowerID],
    queryFn: () => getRowerLifetime(rowerID),
  })
  // Warm sessions cache for other surfaces; return value intentionally unused.
  useQueries({ queries: [{ queryKey: ['sessions', 'list'], queryFn: () => listSessions(50, 0) }] })

  if (lifetimeQ.isPending) {
    return <p className={styles.empty}>Wartung wird geladen …</p>
  }
  const lifetime = lifetimeQ.data
  if (!lifetime) return null

  const sessionCount = lifetime.total_sessions
  const footprintKB = Math.round(sessionCount * 1.2)
  const footprint =
    footprintKB > 1024 ? `~${(footprintKB / 1024).toFixed(1)} MB` : `~${footprintKB} kB`

  return (
    <section className={styles.section} data-testid="wartung-section">
      <h2 className={styles.sectionLabel}>Wartung</h2>
      <div className={styles.row}>
        <span className={styles.label}>Sitzungen</span>
        <span className={styles.value}>{sessionCount}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Geschätzter Speicher</span>
        <span className={styles.value}>{footprint}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Lifetime-Distanz</span>
        <span className={styles.value}>
          {(lifetime.total_distance_m / 1000).toFixed(1)} km
        </span>
      </div>
    </section>
  )
}
