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
 * work-distance = stroke.distance_m − phaseAnchor.distanceM
 *               (distance accumulated since the warmup→work
 *               transition; falls back to 0 when there was no
 *               warmup phase and thus no anchor).
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
  const total = state.stroke?.distance_m ?? 0
  const anchor = state.phaseAnchor?.distanceM ?? 0
  const work = Math.max(0, Math.round(total - anchor))
  return (
    <div className={styles.badge} data-testid="work-progress-badge">
      <span className="tnum">
        {work} / {target}
      </span>
      <span className={styles.unit}>m</span>
    </div>
  )
}
