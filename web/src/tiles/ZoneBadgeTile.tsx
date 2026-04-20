import { selectZone } from './selectors'
import type { TileDef } from './registry'
import type { LiveState } from '../live/reducer'
import styles from './ZoneBadgeTile.module.css'

type Props = { def: TileDef; state: LiveState; disabled?: boolean }

export function ZoneBadgeTile({ def, state, disabled }: Props) {
  const { zone } = selectZone(state, def.id)
  const cls = [styles.tile, disabled && styles.disabled].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <span className={`label-sm ${styles.label}`}>{def.label}</span>
      {zone ? (
        <span className={styles.badge}>{zone}</span>
      ) : (
        <span className={styles.empty}>—</span>
      )}
    </div>
  )
}
