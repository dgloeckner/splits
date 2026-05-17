import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRaceFreeze, type RaceFreezeOpponents } from './useRaceFreeze'
import { computeRaceResultLatch, type RaceResultLatch } from './raceResultLatch'
import { initialLiveState, liveReducer, type LiveState } from '../live/reducer'
import { raceLifecycle, initialRaceLifecycle, type RaceLifecycleState } from './raceLifecycle'

const baseStroke = {
  session_id: 's1',
  stroke: 1,
  time_sec: 0,
  distance_m: 0,
  spm: 0,
  power_w: 0,
  cal_per_hr: 0,
  level: 0,
  dps: 0,
  stroke_cycle_sec: 0,
  pace_sec_per_500m: 0,
  energy_joules: 0,
}

function makeState(stroke: Partial<typeof baseStroke>): LiveState {
  return {
    ...initialLiveState,
    stroke: { ...baseStroke, ...stroke },
  }
}

// Constant-pace 120 s / 500 m opponent.
const ghost = { tSec: [0, 60, 120, 240, 480], distM: [0, 250, 500, 1000, 2000] }
// Slightly faster PB: 110 s / 500 m.
const pb = { tSec: [0, 55, 110, 220, 440], distM: [0, 250, 500, 1000, 2000] }

const opps: RaceFreezeOpponents = { ghost, pb }

describe('useRaceFreeze', () => {
  it('passes live values through before a latchedResult exists', () => {
    const state = makeState({
      time_sec: 100,
      distance_m: 400,
      pace_sec_per_500m: 110,
      power_w: 280,
      spm: 26,
    })
    const { result } = renderHook(() =>
      useRaceFreeze({ liveState: state, totalMeters: 2000, opponents: opps }),
    )
    expect(result.current.frozen).toBe(false)
    expect(result.current.elapsedSec).toBe(100)
    expect(result.current.userDistanceM).toBe(400)
    expect(result.current.split).toBe(110)
    expect(result.current.watts).toBe(280)
    expect(result.current.spm).toBe(26)
  })

  it('sources every field from latchedResult when present', () => {
    const latch = computeRaceResultLatch({
      cross: { t: 470, dist: 2000, watts: 310, spm: 30, split: 118 },
      prev: { t: 460, dist: 1970 },
      totalMeters: 2000,
      opponents: { ghost, pb },
    })
    const later = makeState({
      time_sec: 530,
      distance_m: 2100,
      pace_sec_per_500m: 145,
      power_w: 120,
      spm: 18,
    })
    const { result } = renderHook(() =>
      useRaceFreeze({
        liveState: later,
        totalMeters: 2000,
        opponents: opps,
        latchedResult: latch,
      }),
    )
    expect(result.current.frozen).toBe(true)
    expect(result.current.elapsedSec).toBe(470)
    expect(result.current.userDistanceM).toBe(2000)
    expect(result.current.split).toBe(118)
    expect(result.current.watts).toBe(310)
    expect(result.current.spm).toBe(30)
    expect(result.current.ghostGap).toBeCloseTo(-10, 6)
    expect(result.current.pbGap).toBeCloseTo(30, 6)
  })

  it('returns the same frozen values across re-renders while latch is held', () => {
    const latch = computeRaceResultLatch({
      cross: { t: 470, dist: 2000, watts: 310, spm: 30, split: 118 },
      prev: { t: 460, dist: 1970 },
      totalMeters: 2000,
      opponents: { ghost, pb },
    })
    const { result, rerender } = renderHook(
      ({ s }: { s: LiveState }) =>
        useRaceFreeze({ liveState: s, totalMeters: 2000, opponents: opps, latchedResult: latch }),
      { initialProps: { s: makeState({ time_sec: 530, distance_m: 2100 }) } },
    )
    const first = result.current
    rerender({ s: makeState({ time_sec: 600, distance_m: 2200, power_w: 90, spm: 16 }) })
    expect(result.current).toEqual(first)
  })

  it('REGRESSION: batched SSE delivery — multiple post-horn strokes between renders must not corrupt the freeze', () => {
    // Simulate the bug: between two React commits the live reducer
    // processes the cross stroke AND a follow-up stroke. The committed
    // `liveState.stroke` is therefore the later stroke (well past the
    // line) — but the race lifecycle reducer, which runs per event,
    // latches at the actual cross. `useRaceFreeze` must report the
    // latched cross stroke, not the post-batch live stroke.
    const totalMeters = 500
    let live: LiveState = initialLiveState
    let lifecycle: RaceLifecycleState = initialRaceLifecycle({ totalMeters })
    lifecycle = raceLifecycle(lifecycle, { type: 'confirm' })
    lifecycle = raceLifecycle(lifecycle, { type: 'bereitTap', t: 0 })
    lifecycle = raceLifecycle(lifecycle, { type: 'tick', nowMs: 5000 })
    expect(lifecycle.phase).toBe('Live')

    // Pre-horn stroke at 480 m — both reducers see it.
    live = liveReducer(live, {
      type: 'event',
      event: {
        kind: 'stroke',
        data: { ...baseStroke, time_sec: 90, distance_m: 480, power_w: 290, spm: 28, pace_sec_per_500m: 115 },
      },
    })
    lifecycle = raceLifecycle(lifecycle, {
      type: 'stroke',
      t: 90,
      dist: 480,
      userDistance: 480,
      total: totalMeters,
      watts: 290,
      spm: 28,
      split: 115,
    })
    expect(lifecycle.latchedResult).toBeNull()

    // Now BATCH two more strokes through the live reducer: the cross
    // stroke at 510 m and a follow-up at 734 m. The committed
    // `liveState.stroke` reflects only the follow-up.
    live = liveReducer(live, {
      type: 'event',
      event: {
        kind: 'stroke',
        data: { ...baseStroke, time_sec: 100, distance_m: 510, power_w: 305, spm: 30, pace_sec_per_500m: 110 },
      },
    })
    live = liveReducer(live, {
      type: 'event',
      event: {
        kind: 'stroke',
        data: { ...baseStroke, time_sec: 115, distance_m: 734, power_w: 120, spm: 18, pace_sec_per_500m: 145 },
      },
    })
    expect(live.stroke?.distance_m).toBe(734)

    // The lifecycle reducer DOES see strokes per-event (via RaceFlow's
    // per-commit effect, which in the real app dispatches each stroke as
    // it arrives — modelled here by two sequential dispatches).
    lifecycle = raceLifecycle(lifecycle, {
      type: 'stroke',
      t: 100,
      dist: 510,
      userDistance: 510,
      total: totalMeters,
      watts: 305,
      spm: 30,
      split: 110,
    })
    lifecycle = raceLifecycle(lifecycle, {
      type: 'stroke',
      t: 115,
      dist: 734,
      userDistance: 734,
      total: totalMeters,
      watts: 120,
      spm: 18,
      split: 145,
    })
    expect(lifecycle.phase).toBe('Finished')
    const latch = lifecycle.latchedResult as RaceResultLatch
    // The latch must reflect the cross stroke (100 s, 510 m raw), not
    // the follow-up (115 s, 734 m). `userDistanceM` is normalised to
    // the line (`totalMeters`).
    expect(latch.finalTimeS).toBe(100)
    expect(latch.crossSnapshot.userDistanceM).toBe(totalMeters)
    expect(latch.crossSnapshot.watts).toBe(305)
    expect(latch.crossSnapshot.spm).toBe(30)
    expect(latch.crossSnapshot.split).toBe(110)

    // Critical assertion: even though `liveState.stroke.distance_m` is
    // 734, the hook reports the latched 500 m and 100 s.
    const { result } = renderHook(() =>
      useRaceFreeze({ liveState: live, totalMeters, opponents: {}, latchedResult: latch }),
    )
    expect(result.current.frozen).toBe(true)
    expect(result.current.userDistanceM).toBe(totalMeters)
    expect(result.current.elapsedSec).toBe(100)
    expect(result.current.watts).toBe(305)
    expect(result.current.spm).toBe(30)
    expect(result.current.split).toBe(110)
  })

  it('pre-horn ghost/pb gaps track live values (mid-race snapshot)', () => {
    const mid = makeState({ time_sec: 240, distance_m: 1000 })
    const { result, rerender } = renderHook(
      ({ s }: { s: LiveState }) =>
        useRaceFreeze({ liveState: s, totalMeters: 2000, opponents: opps }),
      { initialProps: { s: mid } },
    )
    expect(result.current.frozen).toBe(false)
    expect(result.current.ghostGap).toBeCloseTo(0, 6)
    expect(result.current.pbGap).toBeCloseTo(20, 6)

    rerender({ s: makeState({ time_sec: 360, distance_m: 1500 }) })
    expect(result.current.frozen).toBe(false)
    expect(result.current.ghostGap).toBeCloseTo(0, 6)
  })

  it('null stroke before any data: pass-through zeros, not frozen', () => {
    const state: LiveState = { ...initialLiveState, stroke: null }
    const { result } = renderHook(() =>
      useRaceFreeze({ liveState: state, totalMeters: 2000, opponents: opps }),
    )
    expect(result.current.frozen).toBe(false)
    expect(result.current.elapsedSec).toBe(0)
    expect(result.current.userDistanceM).toBe(0)
  })

  it('transient freeze when live stroke is past the line but latch has not yet been plumbed in (one-render window)', () => {
    // RaceFlow's effect dispatches strokes to the lifecycle reducer
    // after the live commit. For one render the live stroke is past
    // the line but `latchedResult` is still null. The hook must still
    // appear frozen so the StatBar doesn't flash a moving sprite.
    const cross = makeState({ time_sec: 470, distance_m: 2000, pace_sec_per_500m: 118, power_w: 310, spm: 30 })
    const { result } = renderHook(() =>
      useRaceFreeze({ liveState: cross, totalMeters: 2000, opponents: opps, latchedResult: null }),
    )
    expect(result.current.frozen).toBe(true)
    expect(result.current.userDistanceM).toBe(2000)
  })

  it('no opponents: ghostGap and pbGap are null both before and after horn', () => {
    const mid = makeState({ time_sec: 100, distance_m: 400 })
    const { result, rerender } = renderHook(
      ({ ls, latch }: { ls: LiveState; latch?: RaceResultLatch | null }) =>
        useRaceFreeze({ liveState: ls, totalMeters: 2000, opponents: {}, latchedResult: latch }),
      { initialProps: { ls: mid, latch: null as RaceResultLatch | null } },
    )
    expect(result.current.ghostGap).toBeNull()
    expect(result.current.pbGap).toBeNull()

    const latch = computeRaceResultLatch({
      cross: { t: 470, dist: 2000 },
      prev: { t: 460, dist: 1970 },
      totalMeters: 2000,
      opponents: {},
    })
    rerender({ ls: makeState({ time_sec: 470, distance_m: 2000 }), latch })
    expect(result.current.frozen).toBe(true)
    expect(result.current.ghostGap).toBeNull()
    expect(result.current.pbGap).toBeNull()
  })
})

describe('fmtGap consistency between StatBar and FinishOverlay (DOM)', () => {
  it('renders byte-identical text for the same gap value', async () => {
    const { render } = await import('@testing-library/react')
    const { StatBar } = await import('./StatBar')
    const { FinishOverlay } = await import('./FinishOverlay')
    const latch: RaceResultLatch = {
      finalTimeS: 100,
      finalSplitS: 95,
      gaps: { ghost: 19, pb: -7 },
      crossSnapshot: { userDistanceM: 500, watts: 0, spm: 0, split: 95 },
    }
    const { container: sb } = render(
      <StatBar
        variant="phone"
        elapsedSec={100}
        splitSec={95}
        distanceLeftM={0}
        watts={0}
        vsPbSec={null}
        vsGhostSec={19}
      />,
    )
    const { container: fo } = render(<FinishOverlay result={latch} />)
    const sbText = sb.querySelector('[data-testid="statbar-vs-ghost"]')!.textContent!
    const foText = fo.querySelector('[data-testid="finish-gap-ghost"]')!.textContent!
    // Both should render the same gap formatting. StatBar prefixes
    // the label ("Ghost ") — strip it before comparing.
    const sbGap = sbText.replace(/^Ghost\s*/, '')
    expect(sbGap).toBe(foText)
    expect(sbGap).toBe('+19.0 s')
  })
})
