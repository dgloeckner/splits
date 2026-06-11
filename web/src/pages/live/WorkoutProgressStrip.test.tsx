import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LiveSessionContext } from '../../live/LiveSessionContext'
import { initialLiveState, type LiveState } from '../../live/reducer'
import type { Segment, ActiveSegment } from '../../live/segments'
import { WorkoutOverlayProvider } from './WorkoutOverlayContext'
import { WorkoutProgressStrip, WorkoutProgressStripView } from './WorkoutProgressStrip'

function seg(kind: Segment['kind'], index: number, d?: number, s?: number): Segment {
  return {
    kind, index,
    distanceM: d, durationSec: s,
    startTimeSec: 0, endTimeSec: 0, startDistanceM: 0, endDistanceM: 0,
  }
}

describe('WorkoutProgressStripView', () => {
  it('renders nothing when segments are empty', () => {
    const { container } = render(<WorkoutProgressStripView segments={[]} active={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one block per segment', () => {
    const segs = [
      seg('warmup', 0, undefined, 120),
      seg('work', 1, 500),
      seg('rest', 2, undefined, 60),
      seg('work', 3, 500),
      seg('cooldown', 4, undefined, 120),
    ]
    render(<WorkoutProgressStripView segments={segs} active={null} />)
    const strip = screen.getByTestId('progress-strip')
    expect(strip.children.length).toBe(5)
  })

  it('renders active marker for the active segment', () => {
    const segs = [seg('warmup', 0, undefined, 120), seg('work', 1, 500)]
    const active: ActiveSegment = {
      segment: segs[1],
      remainingM: 250,
      progressRatio: 0.5,
      totalSegments: 2,
      activeIndexOneBased: 2,
    }
    render(<WorkoutProgressStripView segments={segs} active={active} />)
    const marker = screen.getByTestId('progress-marker')
    expect(marker).toBeInTheDocument()
    expect((marker as HTMLElement).style.left).toBe('50%')
  })

  it('no marker when active is null', () => {
    const segs = [seg('work', 0, 500)]
    render(<WorkoutProgressStripView segments={segs} active={null} />)
    expect(screen.queryByTestId('progress-marker')).toBeNull()
  })

  it('renders X abort button when onAbort provided', () => {
    const segs = [seg('work', 0, 500)]
    const onAbort = vi.fn()
    render(<WorkoutProgressStripView segments={segs} active={null} onAbort={onAbort} />)
    expect(screen.getByTestId('progress-strip-abort')).toBeInTheDocument()
  })

  it('omits X when onAbort is absent', () => {
    const segs = [seg('work', 0, 500)]
    render(<WorkoutProgressStripView segments={segs} active={null} />)
    expect(screen.queryByTestId('progress-strip-abort')).toBeNull()
  })
})

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

function mockWorkout() {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({
    id: 'W1', mode: 'distance', params: { meters: 5000 }, intensity: 'moderat',
    warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-24T00:00:00Z',
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
}

const stateWithWorkout: LiveState = {
  ...initialLiveState,
  session: { session_id: 'S1', started_at: '', rower_id: 'R', rower_name: 'A', initial_level: 3, workout_id: 'W1' },
  stroke: { session_id: 'S1', stroke: 1, time_sec: 60, distance_m: 100, spm: 22, power_w: 120, cal_per_hr: 500, level: 3, dps: 9, stroke_cycle_sec: 3, pace_sec_per_500m: 135, energy_joules: 300, work_distance_m: 0, work_time_sec: 0, phase_distance_m: 0, phase_time_sec: 0 },
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

describe('WorkoutProgressStrip (container)', () => {
  it('clicking X opens dialog; Session speichern hides strip', async () => {
    mockWorkout()
    const Wrap = wrap(stateWithWorkout)
    render(<Wrap><WorkoutProgressStrip /></Wrap>)
    await waitFor(() => expect(screen.getByTestId('progress-strip')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('progress-strip-abort'))
    expect(screen.getByTestId('abort-dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('abort-dialog-save'))
    await waitFor(() => expect(screen.queryByTestId('progress-strip')).toBeNull())
  })

  it('Weiter rudern closes dialog and keeps strip', async () => {
    mockWorkout()
    const Wrap = wrap(stateWithWorkout)
    render(<Wrap><WorkoutProgressStrip /></Wrap>)
    await waitFor(() => expect(screen.getByTestId('progress-strip')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('progress-strip-abort'))
    await userEvent.click(screen.getByTestId('abort-dialog-continue'))
    expect(screen.queryByTestId('abort-dialog')).toBeNull()
    expect(screen.getByTestId('progress-strip')).toBeInTheDocument()
  })

  it('Session verwerfen calls DELETE on current session', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      if (url.includes('/api/v1/workouts/')) {
        return new Response(JSON.stringify({
          id: 'W1', mode: 'distance', params: { meters: 5000 }, intensity: 'moderat',
          warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-24T00:00:00Z',
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200 })
    })
    global.fetch = fetchMock as typeof fetch
    const Wrap = wrap(stateWithWorkout)
    render(<Wrap><WorkoutProgressStrip /></Wrap>)
    await waitFor(() => expect(screen.getByTestId('progress-strip')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('progress-strip-abort'))
    await userEvent.click(screen.getByTestId('abort-dialog-discard'))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/sessions/S1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
    await waitFor(() => expect(screen.queryByTestId('progress-strip')).toBeNull())
  })
})
