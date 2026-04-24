import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { listSessions, type SessionRow } from '../api/client'
import { getWorkout, type Workout } from '../api/workouts'
import { formatSessionStart } from '../util/dates'
import { fmtMeters, mmss, pace500m } from '../util/format'
import { workoutChipLabel } from '../util/workoutLabel'
import styles from './HistoryPage.module.css'

export function HistoryPage() {
  const { data, isPending, error } = useQuery<SessionRow[]>({
    queryKey: ['sessions', 'list'],
    queryFn: () => listSessions(50, 0),
  })

  // Fetch the referenced workouts in parallel so each card can render a
  // workout-type chip. React Query dedupes/caches per id so repeat views
  // stay cheap.
  const workoutIds = Array.from(
    new Set((data ?? []).map((s) => s.workout_id).filter((v): v is string => !!v)),
  )
  const workoutQueries = useQueries({
    queries: workoutIds.map((id) => ({
      queryKey: ['workout', id],
      queryFn: () => getWorkout(id),
      staleTime: 60_000,
    })),
  })
  const workoutById = new Map<string, Workout>()
  workoutQueries.forEach((q, i) => {
    if (q.data) workoutById.set(workoutIds[i], q.data)
  })

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

  return (
    <div className={styles.page}>
      <h1 className="headline-sm">Historie</h1>
      <div className={styles.list}>
        {data.map((s) => {
          const workout = s.workout_id ? workoutById.get(s.workout_id) : null
          return (
            <Link key={s.id} to={`/historie/${s.id}`} className={styles.row}>
              <span className={styles.when}>{formatSessionStart(s.started_at)}</span>
              <span className={styles.typeChip}>{workoutChipLabel(workout)}</span>
              <span className={styles.pill}>{fmtMeters(s.total_distance_m ?? null)} m</span>
              <span className={styles.pill}>{mmss(s.total_time_sec ?? null)}</span>
              {s.summary?.avg_pace_sec_per_500m != null && (
                <span className={`${styles.pill} ${styles.pillStrong}`}>
                  {pace500m(s.summary.avg_pace_sec_per_500m)}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
