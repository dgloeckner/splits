import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { LiveState } from '../live/reducer'
import type { RaceOpponent } from '../api/race'
import * as raceApi from '../api/race'
import * as oppHook from './useRaceOpponents'
import { RaceOpponentsContext } from './RaceOpponentsContext'
import { RaceTileAdapter } from './RaceTileAdapter'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as any).ResizeObserver = ResizeObserverStub

const ghost: RaceOpponent = {
  sourceSessionId: 'sess-ghost',
  label: 'ghost',
  tSec: [0, 1, 2, 3],
  split: [120, 119.5, 119.2, 119.0],
}

function makeLiveState(overrides?: Partial<LiveState>): LiveState {
  return {
    status: 'open',
    session: {
      session_id: 'sess-1',
      started_at: new Date().toISOString(),
      rower_id: 'rower-1',
      rower_name: 'Test',
      initial_level: 5,
      workout_id: 'wk-1',
    },
    stroke: {
      session_id: 'sess-1',
      stroke: 1,
      time_sec: 10,
      distance_m: 50,
      power_w: 200,
      pace_sec_per_500m: 120,
      spm: 24,
      cal_per_hr: 0,
      dps: 10,
      stroke_cycle_sec: 2.5,
      energy_joules: 0,
      level: 5,
      phase: 'work',
    },
    summary: null,
    sparklines: { power: [], split: [], dps: [], spm: [] },
    lastStrokeReceivedAtMs: null,
    smoothed: null,
    sessionStartedAtMs: null,
    phase: 'work',
    phaseAnchor: null,
    deviceConnected: true,
    ...overrides,
  }
}

describe('RaceTileAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders RaceTile lanes when an opponent exists', () => {
    vi.spyOn(oppHook, 'useRaceOpponents').mockReturnValue({ ghost, pb: null })
    const { container } = render(<RaceTileAdapter liveState={makeLiveState()} />)
    expect(container.querySelector('[data-lane="user"]')).not.toBeNull()
    expect(container.querySelector('[data-lane="ghost"]')).not.toBeNull()
  })

  it('renders empty wrapper when both opponents are null', () => {
    vi.spyOn(oppHook, 'useRaceOpponents').mockReturnValue({ ghost: null, pb: null })
    const { container } = render(<RaceTileAdapter liveState={makeLiveState()} />)
    expect(container.querySelector('[data-lane]')).toBeNull()
    expect(container.firstChild).not.toBeNull()
  })

  it('renders empty wrapper when disabled', () => {
    vi.spyOn(oppHook, 'useRaceOpponents').mockReturnValue({ ghost, pb: null })
    const { container } = render(<RaceTileAdapter liveState={makeLiveState()} disabled />)
    expect(container.querySelector('[data-lane]')).toBeNull()
    expect(container.firstChild).not.toBeNull()
  })

  it('freezes ghost position when stroke.time_sec stops advancing (pause sync)', () => {
    vi.spyOn(oppHook, 'useRaceOpponents').mockReturnValue({
      ghost: {
        sourceSessionId: 's',
        label: 'ghost',
        tSec: [0, 5, 10, 15, 20],
        split: [120, 120, 120, 120, 120],
      },
      pb: null,
    })
    const before = makeLiveState({
      stroke: {
        session_id: 'sess-1',
        stroke: 1,
        time_sec: 10,
        distance_m: 30,
        power_w: 200,
        pace_sec_per_500m: 120,
        spm: 24,
        cal_per_hr: 0,
        dps: 10,
        stroke_cycle_sec: 2.5,
        energy_joules: 0,
        level: 5,
        phase: 'work',
      },
    })
    const { rerender, container } = render(<RaceTileAdapter liveState={before} />)
    const ghostBefore = container.querySelector('[data-lane="ghost"]')?.innerHTML
    // Re-render with the SAME stroke values (simulates a pause: backend stops emitting strokes,
    // adapter inputs are unchanged).
    rerender(<RaceTileAdapter liveState={before} />)
    const ghostAfter = container.querySelector('[data-lane="ghost"]')?.innerHTML
    expect(ghostAfter).toBe(ghostBefore)
  })

  it('reads opponents from context and skips fetching when provided', () => {
    const fetchSpy = vi
      .spyOn(raceApi, 'fetchRaceOpponents')
      .mockResolvedValue({ ghost: null, pb: null })
    const { container } = render(
      <RaceOpponentsContext.Provider value={{ ghost, pb: null }}>
        <RaceTileAdapter liveState={makeLiveState()} />
      </RaceOpponentsContext.Provider>,
    )
    expect(container.querySelector('[data-lane="ghost"]')).not.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('forwards rower/workout ids to the hook', () => {
    const spy = vi
      .spyOn(oppHook, 'useRaceOpponents')
      .mockReturnValue({ ghost: null, pb: null })
    const ls = makeLiveState({
      session: {
        session_id: 'sess-x',
        started_at: new Date().toISOString(),
        rower_id: 'rower-42',
        rower_name: 'Test',
        initial_level: 5,
        workout_id: 'wk-99',
      },
    })
    render(<RaceTileAdapter liveState={ls} />)
    expect(spy).toHaveBeenCalledWith({ workoutId: 'wk-99', rowerId: 'rower-42' })
  })
})
