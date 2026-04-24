import { selectNumeric } from './selectors'
import type { TileDef } from './registry'
import type { LiveState } from '../live/reducer'
import styles from './NumericTile.module.css'
import { TargetDot } from '../pages/live/TargetDot'
import { useWorkoutProgress } from '../live/useWorkoutProgress'
import { inRange } from '../live/targetRange'

type Props = { def: TileDef; state: LiveState; disabled?: boolean }

export function NumericTile({ def, state, disabled }: Props) {
  const v = selectNumeric(state, def.id)
  const unit = v.unit ?? def.unit
  const cls = [styles.tile, disabled && styles.disabled].filter(Boolean).join(' ')

  const target = useTargetStatus(def.id, state)

  return (
    <div className={cls}>
      <span className={`label-sm ${styles.label}`}>{def.label}</span>
      {target !== 'none' && <TargetDot status={target} className={styles.targetDot} />}
      <div className={styles.row}>
        <span className={`${styles.value} tnum`}>{v.value}</span>
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
    </div>
  )
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
