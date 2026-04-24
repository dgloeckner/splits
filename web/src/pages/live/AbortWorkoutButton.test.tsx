import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LiveSessionContext } from '../../live/LiveSessionContext'
import { initialLiveState, type LiveState } from '../../live/reducer'
import { WorkoutOverlayProvider } from './WorkoutOverlayContext'
import { AbortWorkoutButton } from './AbortWorkoutButton'
import { WorkoutProgressStrip } from './WorkoutProgressStrip'

const originalFetch = global.fetch
afterEach(() => { global.fetch = originalFetch })

function mockWorkout() {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({
    id: 'W1', mode: 'distance', params: { meters: 5000 }, intensity: 'moderat',
    warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-24T00:00:00Z',
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
}

function wrap(state: LiveState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <LiveSessionContext.Provider value={state}>
        <WorkoutOverlayProvider>{children}</WorkoutOverlayProvider>
      </LiveSessionContext.Provider>
    </QueryClientProvider>
  )
}

const stateWithWorkout: LiveState = {
  ...initialLiveState,
  session: { session_id: 'S1', started_at: '', rower_id: 'R', rower_name: 'A', initial_level: 3, workout_id: 'W1' },
  stroke: { session_id: 'S1', stroke: 1, time_sec: 60, distance_m: 100, spm: 22, power_w: 120, cal_per_hr: 500, level: 3, dps: 9, stroke_cycle_sec: 3, pace_sec_per_500m: 135, energy_joules: 300 },
}

const stateNoWorkout: LiveState = {
  ...initialLiveState,
  session: { session_id: 'S1', started_at: '', rower_id: 'R', rower_name: 'A', initial_level: 3 },
}

describe('AbortWorkoutButton', () => {
  it('is hidden when no workout is active', () => {
    mockWorkout()
    const Wrap = wrap(stateNoWorkout)
    render(<Wrap><AbortWorkoutButton /></Wrap>)
    expect(screen.queryByTestId('abort-workout')).toBeNull()
  })

  it('visible when workout active; confirming hides the overlay', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockWorkout()
    const Wrap = wrap(stateWithWorkout)
    render(
      <Wrap>
        <AbortWorkoutButton />
        <WorkoutProgressStrip />
      </Wrap>,
    )
    await waitFor(() => expect(screen.getByTestId('abort-workout')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('progress-strip')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('abort-workout'))
    await waitFor(() => expect(screen.queryByTestId('progress-strip')).toBeNull())
    expect(screen.queryByTestId('abort-workout')).toBeNull()
  })

  it('does nothing when user cancels confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockWorkout()
    const Wrap = wrap(stateWithWorkout)
    render(
      <Wrap>
        <AbortWorkoutButton />
        <WorkoutProgressStrip />
      </Wrap>,
    )
    await waitFor(() => expect(screen.getByTestId('abort-workout')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('abort-workout'))
    // Overlay still present
    expect(screen.getByTestId('progress-strip')).toBeInTheDocument()
  })
})
