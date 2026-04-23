import { WorkoutFlowProvider, useWorkoutFlow } from './WorkoutFlowProvider'
import { Step1Mode } from './Step1Mode'
import { Step2Dimension } from './Step2Dimension'
import { Step3Intensity } from './Step3Intensity'
import styles from './WorkoutFlowPage.module.css'

function FlowBody() {
  const { state } = useWorkoutFlow()
  return (
    <main className={styles.page} data-testid="flow-page" data-step={String(state.step)}>
      <div className={styles.stepIndicator}>
        {state.step === 'confirm' ? 'Bereit' : `${state.step} / 3`}
      </div>
      {state.step === 1 && <Step1Mode />}
      {state.step === 2 && <Step2Dimension />}
      {state.step === 3 && <Step3Intensity />}
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
