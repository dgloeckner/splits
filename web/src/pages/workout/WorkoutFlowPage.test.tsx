import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { WorkoutFlowPage } from './WorkoutFlowPage'
import { useWorkoutFlow } from './WorkoutFlowContext'
import { WorkoutFlowProvider } from './WorkoutFlowProvider'

function Probe() {
  const { state, dispatch } = useWorkoutFlow()
  return (
    <>
      <div data-testid="state-step">{String(state.step)}</div>
      <div data-testid="state-mode">{state.mode ?? ''}</div>
      <div data-testid="state-distance">{state.distanceMeters ?? ''}</div>
      <div data-testid="state-warmup">{`${state.warmupEnabled}-${state.warmupSec}`}</div>
      <button onClick={() => dispatch({ type: 'SELECT_MODE', mode: 'distance' })}>go-dist</button>
      <button onClick={() => dispatch({ type: 'SET_DISTANCE', meters: 5000 })}>set-dist</button>
      <button onClick={() => dispatch({ type: 'GO_TO_STEP3' })}>to-3</button>
      <button onClick={() => dispatch({ type: 'SET_INTENSITY', intensity: 'moderat' })}>set-int</button>
      <button onClick={() => dispatch({ type: 'GO_TO_CONFIRM' })}>to-confirm</button>
      <button onClick={() => dispatch({ type: 'GO_BACK' })}>back</button>
      <button onClick={() => dispatch({ type: 'TOGGLE_WARMUP' })}>toggle-wu</button>
    </>
  )
}

describe('WorkoutFlowProvider', () => {
  it('without mode prop, transitions through legacy steps via SELECT_MODE', () => {
    render(<MemoryRouter><WorkoutFlowProvider><Probe /></WorkoutFlowProvider></MemoryRouter>)
    expect(screen.getByTestId('state-step').textContent).toBe('1')
    act(() => { screen.getByText('go-dist').click() })
    expect(screen.getByTestId('state-step').textContent).toBe('2')
    expect(screen.getByTestId('state-mode').textContent).toBe('distance')
    act(() => { screen.getByText('set-dist').click() })
    expect(screen.getByTestId('state-distance').textContent).toBe('5000')
    act(() => { screen.getByText('to-3').click() })
    expect(screen.getByTestId('state-step').textContent).toBe('3')
    act(() => { screen.getByText('set-int').click(); screen.getByText('to-confirm').click() })
    expect(screen.getByTestId('state-step').textContent).toBe('confirm')
    act(() => { screen.getByText('back').click() })
    expect(screen.getByTestId('state-step').textContent).toBe('3')
  })

  it('with mode prop, seeds step 2 and pre-selected mode', () => {
    render(<MemoryRouter><WorkoutFlowProvider mode="time"><Probe /></WorkoutFlowProvider></MemoryRouter>)
    expect(screen.getByTestId('state-step').textContent).toBe('2')
    expect(screen.getByTestId('state-mode').textContent).toBe('time')
  })

  it('toggles warmup independently of step', () => {
    render(<MemoryRouter><WorkoutFlowProvider><Probe /></WorkoutFlowProvider></MemoryRouter>)
    expect(screen.getByTestId('state-warmup').textContent).toBe('true-300')
    act(() => { screen.getByText('toggle-wu').click() })
    expect(screen.getByTestId('state-warmup').textContent).toBe('false-300')
  })
})

describe('WorkoutFlowPage', () => {
  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<div>HOME</div>} />
          <Route path="/workout/new/:mode" element={<WorkoutFlowPage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('renders Step2Dimension with mode preset from URL', () => {
    renderAt('/workout/new/distance')
    expect(screen.getByRole('heading', { name: 'Distanz wählen' })).toBeInTheDocument()
  })

  it('accepts race mode in URL', () => {
    renderAt('/workout/new/race')
    expect(screen.getByTestId('flow-page').getAttribute('data-mode')).toBe('race')
  })

  it('redirects home for invalid mode', () => {
    renderAt('/workout/new/bogus')
    expect(screen.getByText('HOME')).toBeInTheDocument()
  })

  it('shows a 3-segment progress bar with the first segment filled at start', () => {
    renderAt('/workout/new/time')
    // First step → segment 1 is "-done", segments 2 and 3 are pending.
    expect(screen.getByTestId('flow-step-1-done')).toBeInTheDocument()
    expect(screen.getByTestId('flow-step-2')).toBeInTheDocument()
    expect(screen.getByTestId('flow-step-3')).toBeInTheDocument()
    // Step counter on the right of the header row.
    expect(screen.getByTestId('flow-step-count')).toHaveTextContent('1 / 3')
    // The old text indicators ("1 / 2", "2 / 2", "Bereit") are gone.
    expect(screen.queryByText('1 / 2')).toBeNull()
    expect(screen.queryByText(/^Bereit$/)).toBeNull()
  })

  it('shows the mode label in the flow header', () => {
    renderAt('/workout/new/race')
    expect(screen.getByText('Rennen')).toBeInTheDocument()
  })

  it('back arrow on Step 2 navigates to Home', async () => {
    renderAt('/workout/new/distance')
    await userEvent.click(screen.getByTestId('flow-back'))
    expect(screen.getByText('HOME')).toBeInTheDocument()
  })

  it('back arrow on Step 3 returns to Step 2 (dispatches GO_BACK)', async () => {
    renderAt('/workout/new/distance')
    // Pick a preset to advance to Step 3.
    await userEvent.click(screen.getByRole('button', { name: /500 m/ }))
    expect(screen.getByTestId('flow-step-count')).toHaveTextContent('2 / 3')
    await userEvent.click(screen.getByTestId('flow-back'))
    expect(screen.getByTestId('flow-step-count')).toHaveTextContent('1 / 3')
  })
})
