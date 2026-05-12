import styles from './BereitScreen.module.css'

/**
 * Full-bleed dark Bereit am Catch screen. Renders the chosen distance +
 * opponents above a single large primary button. The component itself
 * does NOT open any live-data subscription — that responsibility lives
 * with the parent and is gated on the lifecycle reducer transitioning
 * past `Bereit` (i.e. only after the user has tapped).
 */
type Props = {
  distanceMeters: number
  opponentsLabel: string
  onTap: () => void
}

export function BereitScreen({ distanceMeters, opponentsLabel, onTap }: Props) {
  return (
    <div className={styles.screen} data-testid="bereit-screen">
      <div className={styles.summary} data-testid="bereit-summary">
        {distanceMeters} m · {opponentsLabel}
      </div>
      <button
        type="button"
        className={styles.button}
        data-testid="bereit-button"
        onClick={onTap}
      >
        Bereit
      </button>
    </div>
  )
}
