import { useWorkoutProgress } from '../../live/useWorkoutProgress'
import { useWorkoutOverlay } from './WorkoutOverlayContext'
import styles from './AbortWorkoutButton.module.css'

export function AbortWorkoutButton() {
  const { workoutId } = useWorkoutProgress()
  const { abort } = useWorkoutOverlay()
  if (!workoutId) return null
  return (
    <button
      type="button"
      className={styles.abort}
      onClick={() => {
        if (window.confirm('Workout abbrechen? Session läuft als Just Row weiter.')) abort()
      }}
      data-testid="abort-workout"
    >
      Workout abbrechen
    </button>
  )
}
