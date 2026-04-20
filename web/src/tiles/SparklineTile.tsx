import { selectSparkline } from './selectors'
import type { TileDef } from './registry'
import type { LiveState } from '../live/reducer'
import { Sparkline } from '../components/Sparkline/Sparkline'
import styles from './SparklineTile.module.css'

type Props = { def: TileDef; state: LiveState; disabled?: boolean }

export function SparklineTile({ def, state, disabled }: Props) {
  const { points } = selectSparkline(state, def.id)
  const cls = [styles.tile, disabled && styles.disabled].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <span className={`label-sm ${styles.label}`}>{def.label}</span>
      <div className={styles.canvas}>
        <Sparkline points={points} />
      </div>
    </div>
  )
}
