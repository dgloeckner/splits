import { selectNumeric } from './selectors'
import type { TileDef } from './registry'
import type { LiveState } from '../live/reducer'
import styles from './NumericTile.module.css'
import { TargetDot } from '../pages/live/TargetDot'
import { useWorkoutProgress } from '../live/useWorkoutProgress'
import { useIsLivePaused, usePhasedDistance, usePhasedTime } from '../live/useLiveDisplay'
import { inRange } from '../live/targetRange'

type Props = { def: TileDef; state: LiveState; disabled?: boolean }

export function NumericTile({ def, state, disabled }: Props) {
  const rawV = selectNumeric(state, def.id)
  const paused = useIsLivePaused(state)
  const phasedDist = usePhasedDistance(state)
  const phasedTime = usePhasedTime(state)

  // For distance and time tiles, replace the selector value with phase-aware values.
  let v = rawV
  if (def.id === 'distanz') v = { value: phasedDist.text, unit: rawV.unit }
  if (def.id === 'zeit') v = { value: phasedTime.text }
  // FEAT-0015 Slice 7 / M11: Distance-to-go needs workout meta. Source
  // the work-phase target from the attached workout and subtract
  // work-phase distance (distance − phaseAnchor.distanceM).
  const dtg = useDistanceToGo(def.id, state)
  if (def.id === 'distanz-uebrig') v = { value: dtg, unit: rawV.unit }
  const unit = v.unit ?? def.unit
  const cls = [styles.tile, disabled && styles.disabled].filter(Boolean).join(' ')

  const target = useTargetStatus(def.id, state)
  const displayValue = paused ? '—' : v.value

  return (
    <div className={cls}>
      <span className={`label-sm ${styles.label}`}>{def.label}</span>
      {!paused && target !== 'none' && <TargetDot status={target} className={styles.targetDot} />}
      <div className={styles.row}>
        <span className={`${styles.value} tnum`}>{displayValue}</span>
        {unit && !paused && <span className={styles.unit}>{unit}</span>}
      </div>
    </div>
  )
}

function useDistanceToGo(tileId: string, state: LiveState): string {
  // Hook order: always called from NumericTile; bail to '—' inside.
  const { workout } = useWorkoutProgress()
  if (tileId !== 'distanz-uebrig') return '—'
  if (!workout || workout.mode !== 'distance') return '—'
  const target = (workout.params as { meters: number }).meters
  if (!target || !Number.isFinite(target)) return '—'
  const total = state.stroke?.distance_m ?? 0
  const anchor = state.phaseAnchor?.distanceM ?? 0
  const work = Math.max(0, total - anchor)
  return String(Math.max(0, Math.round(target - work)))
}

function useTargetStatus(tileId: string, state: LiveState) {
  const { active } = useWorkoutProgress()
  if (!active || active.segment.kind !== 'work') return 'none' as const
  if (tileId === 'split') {
    const s = state.stroke?.pace_sec_per_500m ?? state.smoothed?.paceSecPer500m ?? null
    return inRange(s, active.segment.targetSplit)
  }
  if (tileId === 'spm') {
    const s = state.stroke?.spm ?? state.smoothed?.spm ?? null
    return inRange(s, active.segment.targetSPM)
  }
  return 'none' as const
}
