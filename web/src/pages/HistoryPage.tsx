import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { listSessions, type SessionRow } from '../api/client'
import { useRowers } from '../hooks/useRowers'
import { formatSessionStart } from '../util/dates'
import { fmtMeters, mmss, pace500m } from '../util/format'
import styles from './HistoryPage.module.css'

export function HistoryPage() {
  const { data, isPending, error } = useQuery<SessionRow[]>({
    queryKey: ['sessions', 'list'],
    queryFn: () => listSessions(50, 0),
  })
  const rowers = useRowers()

  if (isPending) {
    return (
      <div className={styles.page}>
        <h1 className="headline-sm">Historie</h1>
        <p className={styles.empty}>Lädt …</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className={styles.page}>
        <h1 className="headline-sm">Historie</h1>
        <p className={styles.empty}>Konnte Sessions nicht laden.</p>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className={styles.page}>
        <h1 className="headline-sm">Historie</h1>
        <p className={styles.empty}>
          Noch keine Sessions. Rudere eine Session und sie erscheint hier.
        </p>
      </div>
    )
  }

  const rowersById = new Map((rowers.data ?? []).map((r) => [r.id, r]))

  return (
    <div className={styles.page}>
      <h1 className="headline-sm">Historie</h1>
      <div className={styles.list}>
        {data.map((s) => {
          const r = rowersById.get(s.rower_id)
          return (
            <Link key={s.id} to={`/historie/${s.id}`} className={styles.row}>
              <span className={styles.when}>{formatSessionStart(s.started_at)}</span>
              <span className={styles.rowerBadge}>
                <span className={styles.rowerDot} style={{ background: r?.color ?? '#555' }} />
                {r?.name ?? '—'}
              </span>
              <span className={styles.pill}>{fmtMeters(s.total_distance_m ?? null)} m</span>
              <span className={styles.pill}>{mmss(s.total_time_sec ?? null)}</span>
              <span className={`${styles.pill} ${styles.pillStrong}`}>
                {pace500m(s.summary?.avg_pace_sec_per_500m ?? null)}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
