import { useWorkoutFlow, type FlowIntensity } from './WorkoutFlowProvider'
import { intensityRanges, formatSpmRange, formatSplitRange } from './intensityRanges'
import styles from './Step3Intensity.module.css'

const options: { id: FlowIntensity; label: string }[] = [
  { id: 'locker', label: 'Locker' },
  { id: 'moderat', label: 'Moderat' },
  { id: 'hart', label: 'Hart' },
  { id: 'allout', label: 'All-out' },
]

export function Step3Intensity() {
  const { dispatch } = useWorkoutFlow()
  function pick(intensity: FlowIntensity) {
    dispatch({ type: 'SET_INTENSITY', intensity })
    dispatch({ type: 'GO_TO_CONFIRM' })
  }
  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={() => dispatch({ type: 'GO_BACK' })} aria-label="Zurück">
          ← Zurück
        </button>
        <h1 className={styles.title}>Intensität</h1>
      </header>
      <ul className={styles.cards}>
        {options.map((opt) => {
          const r = intensityRanges[opt.id]
          return (
            <li key={opt.id}>
              <button
                type="button"
                className={styles.card}
                aria-label={opt.label}
                onClick={() => pick(opt.id)}
              >
                <span className={styles.cardLabel}>{opt.label}</span>
                <span className={styles.range}>
                  <span>Split {formatSplitRange(r.splitSec)}</span>
                  <span>SPM {formatSpmRange(r.spm)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
