import type { ActiveSegment } from '../../live/segments'
import type { Workout } from '../../api/workouts'
import { useWorkoutProgress } from '../../live/useWorkoutProgress'
import { useLiveSession } from '../../live/LiveSessionContext'
import { useExtrapolatedDistanceM, useExtrapolatedTimeSec } from '../../live/useLiveDisplay'
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

function fmtMmSs(sec: number): string {
  const total = Math.max(0, Math.ceil(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatLabel(active: ActiveSegment, workout: Workout): string {
  const seg = active.segment
  if (seg.kind === 'warmup') return `Warm-up · ${fmtMmSs(active.remainingSec ?? 0)}`
  if (seg.kind === 'cooldown') return `Cool-down · ${fmtMmSs(active.remainingSec ?? 0)}`
  if (seg.kind === 'rest') return `Pause · ${fmtMmSs(active.remainingSec ?? 0)}`

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
    return `${fmtMmSs(active.remainingSec ?? 0)} bis Ziel`
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

/**
 * Returns an ActiveSegment whose remainingSec / remainingM / progressRatio
 * are recomputed from the dead-reckoned extrapolated time/distance, so
 * countdowns and the progress marker tick smoothly between strokes.
 */
export function useExtrapolatedActiveSegment(active: ActiveSegment | null): ActiveSegment | null {
  const state = useLiveSession()
  const extT = useExtrapolatedTimeSec(state)
  const extD = useExtrapolatedDistanceM(state)
  if (!active) return null
  const seg = active.segment
  const anchor = state.phaseAnchor
  if (seg.durationSec != null && extT.value != null) {
    const origin = anchor?.timeSec ?? seg.startTimeSec
    const elapsed = Math.max(0, extT.value - origin)
    const remaining = Math.max(0, seg.durationSec - elapsed)
    return { ...active, remainingSec: remaining, progressRatio: elapsed / seg.durationSec }
  }
  if (seg.distanceM != null && extD.value != null) {
    const origin = anchor?.distanceM ?? seg.startDistanceM
    const consumed = Math.max(0, extD.value - origin)
    const remaining = Math.max(0, seg.distanceM - consumed)
    return { ...active, remainingM: remaining, progressRatio: consumed / seg.distanceM }
  }
  return active
}

export function SegmentStatus() {
  const { active, workout } = useWorkoutProgress()
  const display = useExtrapolatedActiveSegment(active)
  return <SegmentStatusView active={display} workout={workout} />
}
