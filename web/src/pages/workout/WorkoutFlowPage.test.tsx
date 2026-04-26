import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { WorkoutFlowPage } from './WorkoutFlowPage'
import { WorkoutFlowProvider, useWorkoutFlow } from './WorkoutFlowProvider'

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

  it('redirects home for invalid mode', () => {
    renderAt('/workout/new/bogus')
    expect(screen.getByText('HOME')).toBeInTheDocument()
  })

  it('shows step indicator "1 / 2" at start', () => {
    renderAt('/workout/new/time')
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })
})
