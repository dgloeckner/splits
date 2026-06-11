import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { initialLiveState, type LiveState } from '../../live/reducer'
import type { Workout } from '../../api/workouts'
import type { StrokePayload } from '../../live/events'
import { WorkProgressBadgeView } from './WorkProgressBadge'

function stroke(work_distance_m: number, distance_m?: number, time_sec = 60): StrokePayload {
  return {
    session_id: 'S1',
    stroke: 1,
    time_sec,
    distance_m: distance_m ?? work_distance_m,
    spm: 22,
    power_w: 120,
    cal_per_hr: 500,
    level: 3,
    dps: 9,
    stroke_cycle_sec: 3,
    pace_sec_per_500m: 135,
    energy_joules: 300,
    work_distance_m,
    work_time_sec: time_sec,
    phase_distance_m: work_distance_m,
    phase_time_sec: time_sec,
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

describe('WorkProgressBadgeView', () => {
  it('renders <work>/<target> m during work phase for distance workouts', () => {
    // work_distance_m=1100 (cumulative 1340m − 240m warmup, stamped by backend)
    const state: LiveState = { ...initialLiveState, phase: 'work', stroke: stroke(1100, 1340) }
    render(<WorkProgressBadgeView state={state} workout={distanceWorkout} />)
    const badge = screen.getByTestId('work-progress-badge')
    expect(badge.textContent).toContain('1100 / 5000')
    expect(badge.textContent).toContain('m')
  })

  it('hides during warmup', () => {
    const state: LiveState = { ...initialLiveState, phase: 'warmup', stroke: stroke(0, 200) }
    render(<WorkProgressBadgeView state={state} workout={distanceWorkout} />)
    expect(screen.queryByTestId('work-progress-badge')).toBeNull()
  })

  it('hides during cooldown', () => {
    const state: LiveState = { ...initialLiveState, phase: 'cooldown', stroke: stroke(4760, 5000) }
    render(<WorkProgressBadgeView state={state} workout={distanceWorkout} />)
    expect(screen.queryByTestId('work-progress-badge')).toBeNull()
  })

  it('hides for non-distance workouts (time mode)', () => {
    const state: LiveState = { ...initialLiveState, phase: 'work', stroke: stroke(500) }
    render(<WorkProgressBadgeView state={state} workout={timeWorkout} />)
    expect(screen.queryByTestId('work-progress-badge')).toBeNull()
  })

  it('hides when no workout is attached', () => {
    const state: LiveState = { ...initialLiveState, phase: 'work', stroke: stroke(500) }
    render(<WorkProgressBadgeView state={state} workout={null} />)
    expect(screen.queryByTestId('work-progress-badge')).toBeNull()
  })

  it('shows 0 when work_distance_m is 0 (no warmup, session start)', () => {
    const noWarmup: Workout = { ...distanceWorkout, warmup_sec: 0 }
    const state: LiveState = { ...initialLiveState, phase: 'work', stroke: stroke(0, 0) }
    render(<WorkProgressBadgeView state={state} workout={noWarmup} />)
    expect(screen.getByTestId('work-progress-badge').textContent).toContain('0 / 5000')
  })

  it('shows work_distance_m when backend stamps it directly (no warmup offset needed)', () => {
    const noWarmup: Workout = { ...distanceWorkout, warmup_sec: 0 }
    const state: LiveState = { ...initialLiveState, phase: 'work', stroke: stroke(800) }
    render(<WorkProgressBadgeView state={state} workout={noWarmup} />)
    expect(screen.getByTestId('work-progress-badge').textContent).toContain('800 / 5000')
  })
})
