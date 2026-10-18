import { describe, it, expect } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { LiveSessionContext } from '../../live/LiveSessionContext'
import { initialLiveState, type LiveState } from '../../live/reducer'
import { useWorkoutOverlay } from './WorkoutOverlayContext'
import { WorkoutOverlayProvider } from './WorkoutOverlayProvider'

function stateWith(sessionId: string | null, workoutId: string | null = 'W1'): LiveState {
  return sessionId
    ? {
        ...initialLiveState,
        session: {
          session_id: sessionId,
          started_at: '',
          rower_id: 'R',
          rower_name: 'A',
          initial_level: 3,
          workout_id: workoutId ?? undefined,
        },
      }
    : { ...initialLiveState }
}

function Probe({ onAbort }: { onAbort?: (fn: () => void) => void }) {
  const { aborted, abort } = useWorkoutOverlay()
  if (onAbort) onAbort(abort)
  return <div data-testid="aborted">{aborted ? 'yes' : 'no'}</div>
}

describe('WorkoutOverlayProvider', () => {
  it('auto-clears aborted when session_id transitions to a new id', () => {
    let abort: () => void = () => {}
    const { rerender } = render(
      <LiveSessionContext.Provider value={stateWith('S1')}>
        <WorkoutOverlayProvider>
          <Probe onAbort={(fn) => (abort = fn)} />
        </WorkoutOverlayProvider>
      </LiveSessionContext.Provider>,
    )
    expect(screen.getByTestId('aborted').textContent).toBe('no')

    act(() => abort())
    expect(screen.getByTestId('aborted').textContent).toBe('yes')

    // New session begins (e.g. user picks a new workout while data flows)
    rerender(
      <LiveSessionContext.Provider value={stateWith('S2', 'W2')}>
        <WorkoutOverlayProvider>
          <Probe onAbort={(fn) => (abort = fn)} />
        </WorkoutOverlayProvider>
      </LiveSessionContext.Provider>,
    )
    expect(screen.getByTestId('aborted').textContent).toBe('no')
  })

  it('keeps aborted true while session_id is unchanged', () => {
    let abort: () => void = () => {}
    const { rerender } = render(
      <LiveSessionContext.Provider value={stateWith('S1')}>
        <WorkoutOverlayProvider>
          <Probe onAbort={(fn) => (abort = fn)} />
        </WorkoutOverlayProvider>
      </LiveSessionContext.Provider>,
    )
    act(() => abort())
    rerender(
      <LiveSessionContext.Provider value={stateWith('S1')}>
        <WorkoutOverlayProvider>
          <Probe onAbort={(fn) => (abort = fn)} />
        </WorkoutOverlayProvider>
      </LiveSessionContext.Provider>,
    )
    expect(screen.getByTestId('aborted').textContent).toBe('yes')
  })
})
