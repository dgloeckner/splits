import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useWorkoutFlow, type FlowMode } from './WorkoutFlowContext'
import { WorkoutFlowProvider } from './WorkoutFlowProvider'
import { Step2Dimension } from './Step2Dimension'
import { Step3Intensity } from './Step3Intensity'
import { ConfirmScreen } from './ConfirmScreen'
import styles from './WorkoutFlowPage.module.css'

const VALID: readonly FlowMode[] = ['distance', 'time', 'intervals', 'race'] as const

const MODE_LABEL: Record<FlowMode, string> = {
  distance: 'Distanz',
  time: 'Zeit',
  intervals: 'Intervalle',
  race: 'Rennen',
}

function FlowBody() {
  const { state, dispatch } = useWorkoutFlow()
  const nav = useNavigate()
  // F1+F2: unified flow header.
  //   row 1: mode label ("Distanz" / "Zeit" / "Intervalle" / "Rennen")
  //          on the left, "N / 3" on the right
  //   row 2: back arrow ◂ + 3-segment progress bar
  // Replaces the prior per-step "← Zurück" links and the broken
  // text indicator ("1 / 2" / "2 / 2" / "Bereit"). One header for the
  // whole wizard keeps the user oriented and pins the back affordance
  // in the same place every step.
  const stepIndex =
    state.step === 'confirm' ? 3 : (state.step as number) - 1
  const modeLabel = state.mode ? MODE_LABEL[state.mode] : ''
  function goBack() {
    // Step 2 is the wizard's first visible step → back exits to Home
    // (the mode picker, conceptually Step 1). Otherwise advance one
    // step backward inside the reducer.
    if (state.step === 2) {
      nav('/')
    } else {
      dispatch({ type: 'GO_BACK' })
    }
  }
  return (
    <main className={styles.page} data-testid="flow-page" data-step={String(state.step)} data-mode={state.mode ?? ''}>
      <header className={styles.flowHeader}>
        <div className={styles.flowHeaderRow}>
          <span className={styles.modeLabel}>{modeLabel}</span>
          <span className={styles.stepCount} data-testid="flow-step-count">
            {stepIndex} / 3
          </span>
        </div>
        <div className={styles.progressRow}>
          <button
            type="button"
            className={styles.backArrow}
            onClick={goBack}
            aria-label="Zurück"
            data-testid="flow-back"
          >
            ←
          </button>
          <div
            className={styles.progress}
            role="progressbar"
            aria-label={`Schritt ${stepIndex} von 3${modeLabel ? ` — ${modeLabel}` : ''}`}
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={stepIndex}
          >
            {[1, 2, 3].map((n) => {
              const done = n <= stepIndex
              return (
                <span
                  key={n}
                  className={styles.segment}
                  data-done={done ? 'true' : undefined}
                  data-testid={`flow-step-${n}${done ? '-done' : ''}`}
                />
              )
            })}
          </div>
        </div>
      </header>
      {state.step === 2 && <Step2Dimension />}
      {state.step === 3 && <Step3Intensity />}
      {state.step === 'confirm' && <ConfirmScreen />}
    </main>
  )
}

export function WorkoutFlowPage() {
  const { mode } = useParams<{ mode: string }>()
  if (!mode || !VALID.includes(mode as FlowMode)) {
    return <Navigate to="/" replace />
  }
  return (
    <WorkoutFlowProvider mode={mode as FlowMode}>
      <FlowBody />
    </WorkoutFlowProvider>
  )
}
