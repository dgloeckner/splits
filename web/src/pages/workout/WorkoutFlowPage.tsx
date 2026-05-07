import { Navigate, useParams } from 'react-router-dom'
import { WorkoutFlowProvider, useWorkoutFlow, type FlowMode } from './WorkoutFlowProvider'
import { Step2Dimension } from './Step2Dimension'
import { Step3Intensity } from './Step3Intensity'
import { ConfirmScreen } from './ConfirmScreen'
import styles from './WorkoutFlowPage.module.css'

const VALID: readonly FlowMode[] = ['distance', 'time', 'intervals', 'race'] as const

function FlowBody() {
  const { state } = useWorkoutFlow()
  const indicator = state.step === 'confirm' ? 'Bereit' : `${(state.step as number) - 1} / 2`
  return (
    <main className={styles.page} data-testid="flow-page" data-step={String(state.step)}>
      <div data-testid="state-mode" hidden>{state.mode ?? ''}</div>
      <div className={styles.stepIndicator}>{indicator}</div>
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
