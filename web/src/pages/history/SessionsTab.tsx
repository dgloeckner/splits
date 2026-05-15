import { useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { deleteSession, listSessions, type SessionRow } from '../../api/client'
import { getWorkout, type Workout } from '../../api/workouts'
import { useActiveRower } from '../../hooks/useActiveRower'
import { formatSessionStart } from '../../util/dates'
import { fmtMeters, mmss, pace500m } from '../../util/format'
import { workoutChipLabel } from '../../util/workoutLabel'
import { DeleteSessionDialog } from './DeleteSessionDialog'
import styles from '../HistoryPage.module.css'

export function SessionsTab() {
  const active = useActiveRower()
  const rowerId = active.data?.id ?? null
  const { data, isPending, error } = useQuery<SessionRow[]>({
    queryKey: ['sessions', 'list', rowerId],
    queryFn: () => listSessions(rowerId!, 50, 0),
    enabled: !!rowerId,
  })

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

  // F5: loading renders a row-shaped skeleton so the user reads it
  // as "data on the way" — not as the empty state's "you have
  // nothing here" message.
  if (isPending) {
    return (
      <div
        className={styles.skeletonList}
        aria-busy="true"
        aria-label="Sessions werden geladen"
        data-testid="sessions-loading"
      >
        <span className={styles.skeletonRow} />
        <span className={styles.skeletonRow} />
        <span className={styles.skeletonRow} />
      </div>
    )
  }
  if (error) return <p className={styles.empty}>Konnte Sessions nicht laden.</p>
  if (!data || data.length === 0) {
    return (
      <p className={styles.empty} data-testid="sessions-empty">
        Noch keine Sessions. Rudere eine Session und sie erscheint hier.
      </p>
    )
  }

  return (
    <div className={styles.list}>
      {data.map((s) => (
        <SessionCard
          key={s.id}
          session={s}
          workout={s.workout_id ? workoutById.get(s.workout_id) ?? null : null}
        />
      ))}
    </div>
  )
}

function SessionCard({ session: s, workout }: { session: SessionRow; workout: Workout | null }) {
  const qc = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const deleteM = useMutation({
    mutationFn: () => deleteSession(s.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      qc.invalidateQueries({ queryKey: ['rower-pbs'] })
      qc.invalidateQueries({ queryKey: ['rower-lifetime'] })
      qc.invalidateQueries({ queryKey: ['rower-achievements'] })
      qc.invalidateQueries({ queryKey: ['rower-trends'] })
      setConfirmOpen(false)
    },
  })
  return (
    <>
      <div className={styles.row}>
        <Link to={`/historie/${s.id}`} className={styles.rowLink}>
          <div className={styles.head}>
            <span className={styles.when}>{formatSessionStart(s.started_at)}</span>
            {s.has_pb && (
              <span
                className={styles.pbBadge}
                role="img"
                aria-label="Neue Bestleistung"
                title="Neue Bestleistung"
                data-testid={`history-pb-${s.id}`}
              >
                🏆
              </span>
            )}
            <span className={styles.typeChip}>{workoutChipLabel(workout)}</span>
          </div>
          <div className={styles.metrics}>
            <span className={styles.pill}>{fmtMeters(s.total_distance_m ?? null)} m</span>
            <span className={styles.pill}>{mmss(s.total_time_sec ?? null)}</span>
            {s.summary?.avg_pace_sec_per_500m != null && (
              <span className={`${styles.pill} ${styles.pillStrong}`}>
                {pace500m(s.summary.avg_pace_sec_per_500m)}
              </span>
            )}
          </div>
        </Link>
        <button
          type="button"
          className={styles.deleteIcon}
          aria-label={`Sitzung ${formatSessionStart(s.started_at)} löschen`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setConfirmOpen(true)
          }}
          data-testid={`history-delete-${s.id}`}
        >
          ✕
        </button>
      </div>
      <DeleteSessionDialog
        open={confirmOpen}
        session={s}
        busy={deleteM.isPending}
        onConfirm={() => deleteM.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
