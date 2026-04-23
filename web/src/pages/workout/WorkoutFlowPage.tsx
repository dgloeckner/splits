import { WorkoutFlowProvider, useWorkoutFlow } from './WorkoutFlowProvider'
import { Step1Mode } from './Step1Mode'
import styles from './WorkoutFlowPage.module.css'

function FlowBody() {
  const { state } = useWorkoutFlow()
  return (
    <main className={styles.page} data-testid="flow-page" data-step={String(state.step)}>
      <div className={styles.stepIndicator}>
        {state.step === 'confirm' ? 'Bereit' : `${state.step} / 3`}
      </div>
      {state.step === 1 && <Step1Mode />}
      {state.step === 2 && <div data-testid="step-2">Step 2 placeholder</div>}
      {state.step === 3 && <div data-testid="step-3">Step 3 placeholder</div>}
      {state.step === 'confirm' && <div data-testid="step-confirm">Confirm placeholder</div>}
    </main>
  )
}

export function WorkoutFlowPage() {
  return (
    <WorkoutFlowProvider>
      <FlowBody />
    </WorkoutFlowProvider>
  )
}
