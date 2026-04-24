import { useWorkoutProgress } from '../../live/useWorkoutProgress'
import type { ActiveSegment, Segment } from '../../live/segments'
import styles from './WorkoutProgressStrip.module.css'

export function WorkoutProgressStrip() {
  const { segments, active } = useWorkoutProgress()
  return <WorkoutProgressStripView segments={segments} active={active} />
}

export type ViewProps = { segments: Segment[]; active: ActiveSegment | null }

export function WorkoutProgressStripView({ segments, active }: ViewProps) {
  if (segments.length === 0) return null
  return (
    <div
      className={styles.strip}
      data-testid="progress-strip"
      role="progressbar"
      aria-label="Workout-Fortschritt"
    >
      {segments.map((seg) => {
        const cost = segmentCost(seg)
        const isActive = active?.segment.index === seg.index
        return (
          <span
            key={seg.index}
            className={`${styles.block} ${styles[`block_${seg.kind}`]}`}
            style={{ flexGrow: cost }}
            data-active={isActive ? 'true' : undefined}
          >
            {isActive && (
              <span
                className={styles.marker}
                style={{ left: `${Math.max(0, Math.min(1, active!.progressRatio)) * 100}%` }}
                data-testid="progress-marker"
              />
            )}
          </span>
        )
      })}
    </div>
  )
}

function segmentCost(seg: Segment): number {
  if (seg.distanceM) return seg.distanceM
  if (seg.durationSec) return seg.durationSec * 3
  return 1
}
