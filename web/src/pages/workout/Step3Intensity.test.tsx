import { describe, it, expect } from 'vitest'
import { useEffect } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { WorkoutFlowProvider, useWorkoutFlow, type FlowIntensity } from './WorkoutFlowProvider'
import { Step3Intensity } from './Step3Intensity'

function Harness({ out }: { out: { step: unknown; intensity?: FlowIntensity } }) {
  const { state, dispatch } = useWorkoutFlow()
  useEffect(() => {
    if (state.step === 1) {
      dispatch({ type: 'SELECT_MODE', mode: 'distance' })
      dispatch({ type: 'SET_DISTANCE', meters: 5000 })
      dispatch({ type: 'GO_TO_STEP3' })
    }
  }, [state.step, dispatch])
  out.step = state.step
  out.intensity = state.intensity
  return state.step === 3 ? <Step3Intensity /> : null
}

describe('Step3Intensity', () => {
  it('renders all four options with split + SPM ranges', async () => {
    const out = { step: 0 as unknown }
    render(<MemoryRouter><WorkoutFlowProvider><Harness out={out} /></WorkoutFlowProvider></MemoryRouter>)
    expect(await screen.findByRole('button', { name: 'Locker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Moderat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hart' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All-out' })).toBeInTheDocument()
    expect(screen.getByText(/2:20 – 2:40/)).toBeInTheDocument()
    expect(screen.getByText(/< 1:50/)).toBeInTheDocument()
    expect(screen.getByText(/30\+/)).toBeInTheDocument()
  })

  it.each([
    ['Locker', 'locker'],
    ['Moderat', 'moderat'],
    ['Hart', 'hart'],
    ['All-out', 'allout'],
  ])('%s selection sets intensity and advances to confirm', async (label, expected) => {
    const out = { step: 0 as unknown, intensity: undefined as FlowIntensity | undefined }
    render(<MemoryRouter><WorkoutFlowProvider><Harness out={out} /></WorkoutFlowProvider></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: label }))
    expect(out.intensity).toBe(expected)
    expect(out.step).toBe('confirm')
  })

  it('Zurück dispatches GO_BACK (back to step 2)', async () => {
    const out = { step: 0 as unknown }
    render(<MemoryRouter><WorkoutFlowProvider><Harness out={out} /></WorkoutFlowProvider></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /zurück/i }))
    expect(out.step).toBe(2)
  })
})
