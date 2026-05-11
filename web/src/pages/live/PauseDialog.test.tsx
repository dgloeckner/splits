import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LiveSessionContext } from '../../live/LiveSessionContext'
import { initialLiveState, type LiveState } from '../../live/reducer'
import { WorkoutOverlayProvider } from './WorkoutOverlayContext'
import { PauseDialog } from './PauseDialog'

// A paused session with an active stroke and the given phase.
function pausedState(phase: LiveState['phase']): LiveState {
  return {
    ...initialLiveState,
    session: {
      session_id: 'S1',
      started_at: '',
      rower_id: 'R',
      rower_name: 'A',
      initial_level: 3,
      workout_id: 'W1',
    },
    stroke: {
      session_id: 'S1',
      stroke: 1,
      time_sec: 60,
      distance_m: 100,
      spm: 22,
      power_w: 120,
      cal_per_hr: 500,
      level: 3,
      dps: 9,
      stroke_cycle_sec: 3,
      pace_sec_per_500m: 135,
      energy_joules: 300,
    },
    // Last stroke received well past pause threshold (4000ms) → paused.
    lastStrokeReceivedAtMs: 0,
    phase,
  }
}

function wrap(state: LiveState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LiveSessionContext.Provider value={state}>
          <WorkoutOverlayProvider>{children}</WorkoutOverlayProvider>
        </LiveSessionContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  // Force Date.now() large so (Date.now() - lastStrokeReceivedAtMs) >> pauseThresholdMs.
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('PauseDialog phase-gate (Slice 1)', () => {
  it('auto-opens during work phase', () => {
    const Wrap = wrap(pausedState('work'))
    render(
      <Wrap>
        <PauseDialog />
      </Wrap>,
    )
    expect(screen.getByTestId('abort-dialog')).toBeInTheDocument()
  })

  it('does NOT auto-open during warmup', () => {
    const Wrap = wrap(pausedState('warmup'))
    render(
      <Wrap>
        <PauseDialog />
      </Wrap>,
    )
    expect(screen.queryByTestId('abort-dialog')).toBeNull()
  })

  it('does NOT auto-open during cooldown', () => {
    const Wrap = wrap(pausedState('cooldown'))
    render(
      <Wrap>
        <PauseDialog />
      </Wrap>,
    )
    expect(screen.queryByTestId('abort-dialog')).toBeNull()
  })

  it('auto-opens for FreeRow (phase = null) — no-phase sessions retain today behaviour', () => {
    const Wrap = wrap(pausedState(null))
    render(
      <Wrap>
        <PauseDialog />
      </Wrap>,
    )
    expect(screen.getByTestId('abort-dialog')).toBeInTheDocument()
  })
})
