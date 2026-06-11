import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LiveSessionContext } from '../live/LiveSessionContext'
import { initialLiveState, type LiveState } from '../live/reducer'
import { WorkoutOverlayProvider } from '../pages/live/WorkoutOverlayContext'
import { NumericTile } from './NumericTile'
import { getTile } from './registry'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

function mockDistanceWorkout(meters = 5000) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({
    id: 'W1', mode: 'distance', params: { meters }, intensity: 'moderat',
    warmup_sec: 120, cooldown_sec: 0, created_at: '2026-04-24T00:00:00Z',
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
}

function mockTimeWorkout() {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({
    id: 'W2', mode: 'time', params: { seconds: 1200 }, intensity: 'moderat',
    warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-24T00:00:00Z',
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
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

const baseState: LiveState = {
  ...initialLiveState,
  session: { session_id: 'S1', started_at: '', rower_id: 'R', rower_name: 'A', initial_level: 3, workout_id: 'W1' },
  phase: 'work',
  lastStrokeReceivedAtMs: Date.now(),
  stroke: {
    session_id: 'S1', stroke: 50, time_sec: 600, distance_m: 1340,
    spm: 22, power_w: 120, cal_per_hr: 500, level: 3,
    dps: 9, stroke_cycle_sec: 3, pace_sec_per_500m: 135, energy_joules: 300,
    // work_distance_m = 1340 − 240 warmup = 1100; target − 1100 = 3900
    work_distance_m: 1100, work_time_sec: 600,
    phase_distance_m: 1100, phase_time_sec: 600,
  },
}

describe('DistanceToGoTile (NumericTile distanz-uebrig)', () => {
  it('renders übrig label and target − work distance', async () => {
    mockDistanceWorkout(5000)
    const def = getTile('distanz-uebrig')!
    const Wrap = wrap(baseState)
    const { container } = render(
      <Wrap>
        <NumericTile def={def} state={baseState} />
      </Wrap>,
    )
    // work distance = 1340 − 240 = 1100; target − work = 5000 − 1100 = 3900
    await waitFor(() => expect(container.textContent).toContain('3900'))
    expect(screen.getByText('übrig')).toBeInTheDocument()
    expect(container.textContent).toContain('m')
  })

  it('shows — when workout mode is not distance', async () => {
    mockTimeWorkout()
    const def = getTile('distanz-uebrig')!
    const Wrap = wrap(baseState)
    const { container } = render(
      <Wrap>
        <NumericTile def={def} state={baseState} />
      </Wrap>,
    )
    await waitFor(() => expect(container.textContent).toContain('—'))
  })
})

describe('tile registry — distanz-uebrig', () => {
  it('is registered as a numeric tile with unit m and label "übrig"', () => {
    const def = getTile('distanz-uebrig')
    expect(def).toBeDefined()
    expect(def!.type).toBe('numeric')
    expect(def!.unit).toBe('m')
    expect(def!.label).toBe('übrig')
    expect(def!.category).toBe('zahlen')
  })
})
