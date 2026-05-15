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
  const { state, dispatch } = useWorkoutFlow()
  function pick(intensity: FlowIntensity) {
    dispatch({ type: 'SET_INTENSITY', intensity })
    dispatch({ type: 'GO_TO_CONFIRM' })
  }
  const subtitle =
    state.mode === 'race'
      ? 'Wie schnell dein synthetischer Geist rudert.'
      : 'Dein Zieltempo — Split und Schlagzahl auf der Live-Anzeige.'
  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        {/* Back-navigation moved up to WorkoutFlowPage's unified flow header. */}
        <h1 className={styles.title}>Intensität</h1>
        <p className={styles.subtitle}>{subtitle}</p>
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
