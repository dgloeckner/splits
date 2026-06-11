import { useLiveSession } from '../../live/LiveSessionContext'
import { useWorkoutProgress } from '../../live/useWorkoutProgress'
import type { LiveState } from '../../live/reducer'
import type { Workout } from '../../api/workouts'
import styles from './WorkProgressBadge.module.css'

/**
 * FEAT-0015 Slice 7 / M10.
 *
 * Persistent `<workDistanceM> / <targetM> m` badge under the
 * progress strip while the workout is in its work phase and the
 * workout is in Distance mode. Hidden during warmup and cooldown,
 * and for non-Distance modes.
 *
 * work-distance = stroke.work_distance_m (backend-stamped).
 */
export function WorkProgressBadge() {
  const state = useLiveSession()
  const { workout } = useWorkoutProgress()
  return <WorkProgressBadgeView state={state} workout={workout} />
}

export type ViewProps = { state: LiveState; workout: Workout | null }

export function WorkProgressBadgeView({ state, workout }: ViewProps) {
  if (state.phase !== 'work') return null
  if (!workout || workout.mode !== 'distance') return null
  const target = (workout.params as { meters: number }).meters
  if (!target || !Number.isFinite(target)) return null
  const work = Math.max(0, Math.round(state.stroke?.work_distance_m ?? 0))
  return (
    <div className={styles.badge} data-testid="work-progress-badge">
      <span className="tnum">
        {work} / {target}
      </span>
      <span className={styles.unit}>m</span>
    </div>
  )
}
