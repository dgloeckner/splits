import type { ActiveSegment } from '../../live/segments'
import type { Workout } from '../../api/workouts'
import { useWorkoutProgress } from '../../live/useWorkoutProgress'
import styles from './SegmentStatus.module.css'

export type ViewProps = { active: ActiveSegment | null; workout: Workout | null }

export function SegmentStatusView({ active, workout }: ViewProps) {
  if (!active || !workout) return null
  const label = formatLabel(active, workout)
  const urgent = active.remainingSec != null && active.remainingSec <= 10 && active.remainingSec >= 0
  return (
    <div className={`${styles.banner} ${urgent ? styles.urgent : ''}`} data-testid="segment-status">
      {label}
    </div>
  )
}

export function formatLabel(active: ActiveSegment, workout: Workout): string {
  const seg = active.segment
  if (seg.kind === 'warmup') return `Warm-up · ${Math.ceil(active.remainingSec ?? 0)}s`
  if (seg.kind === 'cooldown') return `Cool-down · ${Math.ceil(active.remainingSec ?? 0)}s`
  if (seg.kind === 'rest') return `Pause · ${Math.ceil(active.remainingSec ?? 0)}s`

  // work kind:
  if (workout.mode === 'intervals') {
    const params = workout.params as { reps: number; length: { unit: 'm' | 'min'; value: number } }
    // Walk segments up to active index, count work occurrences.
    const workIndex = countWorkUpTo(active.activeIndexOneBased - 1, workout)
    const lengthLabel = params.length.unit === 'm' ? `${params.length.value} m` : `${params.length.value} min`
    return `Intervall ${workIndex} / ${params.reps} · ${lengthLabel}`
  }
  if (workout.mode === 'distance') {
    return `${Math.ceil(active.remainingM ?? 0)} m bis Ziel`
  }
  if (workout.mode === 'time') {
    return `${Math.ceil(active.remainingSec ?? 0)}s bis Ziel`
  }
  return ''
}

// Count how many work segments appear at or before `includingIndex` (0-based segment index).
function countWorkUpTo(includingIndex: number, workout: Workout): number {
  // For intervals: pattern is [warmup?] work rest work rest ... work [cooldown?]
  let count = 0
  let idx = 0
  const warmup = workout.warmup_sec > 0
  if (warmup) {
    if (idx === includingIndex) return count
    idx++
  }
  const p = workout.params as { reps: number; length: { unit: string; value: number }; rest_sec: number }
  for (let i = 0; i < p.reps; i++) {
    count++
    if (idx === includingIndex) return count
    idx++
    if (i < p.reps - 1) {
      if (idx === includingIndex) return count
      idx++
    }
  }
  return count
}

export function SegmentStatus() {
  const { active, workout } = useWorkoutProgress()
  return <SegmentStatusView active={active} workout={workout} />
}
