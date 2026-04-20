import { selectNumeric } from './selectors'
import type { TileDef } from './registry'
import type { LiveState } from '../live/reducer'
import styles from './NumericTile.module.css'

type Props = { def: TileDef; state: LiveState; disabled?: boolean }

export function NumericTile({ def, state, disabled }: Props) {
  const v = selectNumeric(state, def.id)
  const unit = v.unit ?? def.unit
  const cls = [styles.tile, disabled && styles.disabled].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <span className={`label-sm ${styles.label}`}>{def.label}</span>
      <div className={styles.row}>
        <span className={`${styles.value} tnum`}>{v.value}</span>
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
    </div>
  )
}
