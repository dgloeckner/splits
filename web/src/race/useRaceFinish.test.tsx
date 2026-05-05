import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { initialLiveState, type LiveState } from '../live/reducer'
import type { SessionEndSummary } from '../live/events'
import type { RaceOpponent, RaceOpponentsResponse } from '../api/race'
import { useRaceFinish } from './useRaceFinish'

function makeOpp(label: 'pb' | 'ghost', splitSec: number): RaceOpponent {
  const tSec: number[] = []
  const split: number[] = []
  for (let t = 0; t <= 600; t += 1) {
    tSec.push(t)
    split.push(splitSec)
  }
  return { sourceSessionId: `s-${label}`, label, tSec, split }
}

const summary: SessionEndSummary = {
  total_distance_m: 1000,
  total_time_sec: 240,
  total_strokes: 100,
  avg_power_w: 200,
  peak_power_w: 260,
  avg_spm: 26,
  avg_dps: 9.5,
  avg_pace_sec_per_500m: 120,
  session_calories: 80,
}

describe('useRaceFinish', () => {
  it('returns null initially', () => {
    const opps: RaceOpponentsResponse = { ghost: makeOpp('ghost', 120), pb: makeOpp('pb', 118) }
    const { result } = renderHook(() =>
      useRaceFinish({ liveState: initialLiveState, opponents: opps, aborted: false }),
    )
    expect(result.current).toBeNull()
  })

  it('sets a non-null result when summary transitions to set with both opponents', () => {
    const opps: RaceOpponentsResponse = {
      ghost: makeOpp('ghost', 120), // 1000 m at t = 240
      pb: makeOpp('pb', 118), // faster: 1000 m at t = 236
    }
    const initial: LiveState = { ...initialLiveState, summary: null }
    const { result, rerender } = renderHook(
      (props: { state: LiveState; aborted: boolean }) =>
        useRaceFinish({ liveState: props.state, opponents: opps, aborted: props.aborted }),
      { initialProps: { state: initial, aborted: false } },
    )
    expect(result.current).toBeNull()
    rerender({ state: { ...initialLiveState, summary }, aborted: false })
    expect(result.current).not.toBeNull()
    // Ghost: 240 - 240 = 0; PB: 240 - 236 = 4 (user slower).
    expect(result.current?.vsGhostSec).toBeCloseTo(0, 5)
    expect(result.current?.vsPbSec).toBeCloseTo(4, 5)
  })

  it('aborted at finish leaves result null', () => {
    const opps: RaceOpponentsResponse = { ghost: makeOpp('ghost', 120), pb: makeOpp('pb', 118) }
    const initial: LiveState = { ...initialLiveState, summary: null }
    const { result, rerender } = renderHook(
      (props: { state: LiveState; aborted: boolean }) =>
        useRaceFinish({ liveState: props.state, opponents: opps, aborted: props.aborted }),
      { initialProps: { state: initial, aborted: false } },
    )
    rerender({ state: { ...initialLiveState, summary }, aborted: true })
    expect(result.current).toBeNull()
  })

  it('resets to null when summary returns to null (new session)', () => {
    const opps: RaceOpponentsResponse = { ghost: makeOpp('ghost', 120), pb: null }
    const { result, rerender } = renderHook(
      (props: { state: LiveState; aborted: boolean }) =>
        useRaceFinish({ liveState: props.state, opponents: opps, aborted: props.aborted }),
      {
        initialProps: {
          state: { ...initialLiveState, summary: null } as LiveState,
          aborted: false,
        },
      },
    )
    rerender({ state: { ...initialLiveState, summary }, aborted: false })
    expect(result.current).not.toBeNull()
    rerender({ state: { ...initialLiveState, summary: null }, aborted: false })
    expect(result.current).toBeNull()
  })

  it('with only one opponent the other gap is null', () => {
    const opps: RaceOpponentsResponse = { ghost: null, pb: makeOpp('pb', 118) }
    const { result, rerender } = renderHook(
      (props: { state: LiveState; aborted: boolean }) =>
        useRaceFinish({ liveState: props.state, opponents: opps, aborted: props.aborted }),
      {
        initialProps: {
          state: { ...initialLiveState, summary: null } as LiveState,
          aborted: false,
        },
      },
    )
    rerender({ state: { ...initialLiveState, summary }, aborted: false })
    expect(result.current).not.toBeNull()
    expect(result.current?.vsGhostSec).toBeNull()
    expect(result.current?.vsPbSec).toBeCloseTo(4, 5)
  })
})
