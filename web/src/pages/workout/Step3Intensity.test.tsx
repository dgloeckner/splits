import { describe, it, expect } from 'vitest'
import { useEffect } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { WorkoutFlowProvider, useWorkoutFlow, type FlowIntensity, type FlowMode } from './WorkoutFlowProvider'
import { Step3Intensity } from './Step3Intensity'

function Harness({ out, mode = 'distance' }: { out: { step: unknown; intensity?: FlowIntensity }; mode?: FlowMode }) {
  const { state, dispatch } = useWorkoutFlow()
  useEffect(() => {
    if (state.step === 1) {
      dispatch({ type: 'SELECT_MODE', mode })
      if (mode === 'distance') dispatch({ type: 'SET_DISTANCE', meters: 5000 })
      if (mode === 'time') dispatch({ type: 'SET_TIME', seconds: 1200 })
      if (mode === 'race') dispatch({ type: 'SET_DISTANCE', meters: 2000 })
      dispatch({ type: 'GO_TO_STEP3' })
    }
  }, [state.step, dispatch, mode])
  out.step = state.step
  out.intensity = state.intensity
  return state.step === 3 ? <Step3Intensity /> : null
}

const RACE_SUBTITLE = 'Wie schnell dein synthetischer Geist rudert.'
const NON_RACE_SUBTITLE = 'Dein Zieltempo — Split und Schlagzahl auf der Live-Anzeige.'

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

  // Back-nav moved to WorkoutFlowPage's unified flow header
  // (F1+F2). Covered by WorkoutFlowPage.test.tsx.

  it('shows race subtitle in race mode', async () => {
    const out = { step: 0 as unknown }
    render(<MemoryRouter><WorkoutFlowProvider><Harness out={out} mode="race" /></WorkoutFlowProvider></MemoryRouter>)
    await screen.findByRole('button', { name: 'Locker' })
    expect(screen.getByText(RACE_SUBTITLE)).toBeInTheDocument()
    expect(screen.queryByText(NON_RACE_SUBTITLE)).not.toBeInTheDocument()
  })

  it('shows non-race subtitle in distance mode', async () => {
    const out = { step: 0 as unknown }
    render(<MemoryRouter><WorkoutFlowProvider><Harness out={out} mode="distance" /></WorkoutFlowProvider></MemoryRouter>)
    await screen.findByRole('button', { name: 'Locker' })
    expect(screen.getByText(NON_RACE_SUBTITLE)).toBeInTheDocument()
    expect(screen.queryByText(RACE_SUBTITLE)).not.toBeInTheDocument()
  })

  it('shows non-race subtitle in time mode', async () => {
    const out = { step: 0 as unknown }
    render(<MemoryRouter><WorkoutFlowProvider><Harness out={out} mode="time" /></WorkoutFlowProvider></MemoryRouter>)
    await screen.findByRole('button', { name: 'Locker' })
    expect(screen.getByText(NON_RACE_SUBTITLE)).toBeInTheDocument()
    expect(screen.queryByText(RACE_SUBTITLE)).not.toBeInTheDocument()
  })
})
