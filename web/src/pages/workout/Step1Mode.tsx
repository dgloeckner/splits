import { useNavigate } from 'react-router-dom'
import { useWorkoutFlow } from './WorkoutFlowProvider'
import styles from './Step1Mode.module.css'

export function Step1Mode() {
  const { dispatch } = useWorkoutFlow()
  const nav = useNavigate()

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={() => nav('/')} aria-label="Zurück">
          ← Zurück
        </button>
        <h1 className={styles.title}>Workout wählen</h1>
      </header>
      <ul className={styles.cards}>
        <li>
          <button type="button" aria-label="Distanz" className={styles.card} onClick={() => dispatch({ type: 'SELECT_MODE', mode: 'distance' })}>
            <span className={styles.cardLabel} aria-hidden="true">Distanz</span>
            <span className={styles.cardHint}>500 m bis Marathon</span>
          </button>
        </li>
        <li>
          <button type="button" aria-label="Zeit" className={styles.card} onClick={() => dispatch({ type: 'SELECT_MODE', mode: 'time' })}>
            <span className={styles.cardLabel} aria-hidden="true">Zeit</span>
            <span className={styles.cardHint}>10 bis 60 min</span>
          </button>
        </li>
        <li>
          <button type="button" aria-label="Intervalle" className={styles.card} onClick={() => dispatch({ type: 'SELECT_MODE', mode: 'intervals' })}>
            <span className={styles.cardLabel} aria-hidden="true">Intervalle</span>
            <span className={styles.cardHint}>Presets oder frei konfigurieren</span>
          </button>
        </li>
      </ul>
    </div>
  )
}
