import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { initialLiveState, type LiveState } from '../../live/reducer'
import type { Workout } from '../../api/workouts'
import type { StrokePayload } from '../../live/events'
import { WorkProgressBadgeView } from './WorkProgressBadge'

function stroke(distance_m: number, time_sec = 60): StrokePayload {
  return {
    session_id: 'S1',
    stroke: 1,
    time_sec,
    distance_m,
    spm: 22,
    power_w: 120,
    cal_per_hr: 500,
    level: 3,
    dps: 9,
    stroke_cycle_sec: 3,
    pace_sec_per_500m: 135,
    energy_joules: 300,
  }
}

const distanceWorkout: Workout = {
  id: 'W1', mode: 'distance', params: { meters: 5000 },
  warmup_sec: 120, cooldown_sec: 0, created_at: '2026-04-24T00:00:00Z',
}

const timeWorkout: Workout = {
  id: 'W2', mode: 'time', params: { seconds: 1200 },
  warmup_sec: 120, cooldown_sec: 0, created_at: '2026-04-24T00:00:00Z',
}

function stateWith(phase: LiveState['phase'], dist: number, anchorDist = 0): LiveState {
  return {
    ...initialLiveState,
    phase,
    phaseAnchor: anchorDist > 0 ? { distanceM: anchorDist, timeSec: 0 } : null,
    stroke: stroke(dist),
  }
}

describe('WorkProgressBadgeView', () => {
  it('renders <work>/<target> m during work phase for distance workouts', () => {
    const state = stateWith('work', 1340, 240)
    render(<WorkProgressBadgeView state={state} workout={distanceWorkout} />)
    const badge = screen.getByTestId('work-progress-badge')
    expect(badge.textContent).toContain('1100 / 5000')
    expect(badge.textContent).toContain('m')
  })

  it('hides during warmup', () => {
    const state = stateWith('warmup', 200, 0)
    render(<WorkProgressBadgeView state={state} workout={distanceWorkout} />)
    expect(screen.queryByTestId('work-progress-badge')).toBeNull()
  })

  it('hides during cooldown', () => {
    const state = stateWith('cooldown', 5000, 240)
    render(<WorkProgressBadgeView state={state} workout={distanceWorkout} />)
    expect(screen.queryByTestId('work-progress-badge')).toBeNull()
  })

  it('hides for non-distance workouts (time mode)', () => {
    const state = stateWith('work', 500, 0)
    render(<WorkProgressBadgeView state={state} workout={timeWorkout} />)
    expect(screen.queryByTestId('work-progress-badge')).toBeNull()
  })

  it('hides when no workout is attached', () => {
    const state = stateWith('work', 500, 0)
    render(<WorkProgressBadgeView state={state} workout={null} />)
    expect(screen.queryByTestId('work-progress-badge')).toBeNull()
  })

  it('falls back to 0 anchor when phaseAnchor is null (no warmup)', () => {
    const noWarmup: Workout = { ...distanceWorkout, warmup_sec: 0 }
    const state: LiveState = {
      ...initialLiveState,
      phase: 'work',
      phaseAnchor: null,
      stroke: stroke(800),
    }
    render(<WorkProgressBadgeView state={state} workout={noWarmup} />)
    expect(screen.getByTestId('work-progress-badge').textContent).toContain('800 / 5000')
  })
})
