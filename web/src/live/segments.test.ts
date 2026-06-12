import { describe, it, expect } from 'vitest'
import { expandWorkout, locateSegment } from './segments'
import type { Workout } from '../api/workouts'

function make(overrides: Partial<Workout> & Pick<Workout, 'mode' | 'params'>): Workout {
  return {
    id: 'W',
    intensity: undefined,
    warmup_sec: 0,
    cooldown_sec: 0,
    created_at: '2026-04-24T00:00:00Z',
    ...overrides,
  } as Workout
}

describe('expandWorkout', () => {
  it('distance with WU+CD yields 3 segments in order', () => {
    const segs = expandWorkout(make({
      mode: 'distance',
      params: { meters: 5000 },
      intensity: 'moderat',
      warmup_sec: 300,
      cooldown_sec: 300,
    }))
    expect(segs.map((s) => s.kind)).toEqual(['warmup', 'work', 'cooldown'])
    expect(segs[1].distanceM).toBe(5000)
    expect(segs[1].targetSplit).toBeDefined()
    expect(segs[0].targetSplit).toBeUndefined()
  })

  it('distance-only workout (no WU/CD)', () => {
    const segs = expandWorkout(make({ mode: 'distance', params: { meters: 2000 } }))
    expect(segs).toHaveLength(1)
    expect(segs[0].kind).toBe('work')
    expect(segs[0].distanceM).toBe(2000)
  })

  it('time workout: one time-bounded work segment', () => {
    const segs = expandWorkout(make({ mode: 'time', params: { seconds: 1800 } }))
    expect(segs).toHaveLength(1)
    expect(segs[0].durationSec).toBe(1800)
    expect(segs[0].distanceM).toBeUndefined()
  })

  it('intervals meters: 4×500m rest 60s → 7 segments', () => {
    const segs = expandWorkout(make({
      mode: 'intervals',
      params: { reps: 4, length: { unit: 'm', value: 500 }, rest_sec: 60 },
    }))
    expect(segs.map((s) => s.kind)).toEqual([
      'work', 'rest', 'work', 'rest', 'work', 'rest', 'work',
    ])
    expect(segs[0].distanceM).toBe(500)
    expect(segs[1].durationSec).toBe(60)
  })

  it('intervals minutes: 3×1.5min → work in seconds', () => {
    const segs = expandWorkout(make({
      mode: 'intervals',
      params: { reps: 3, length: { unit: 'min', value: 1.5 }, rest_sec: 30 },
    }))
    const workDurations = segs.filter((s) => s.kind === 'work').map((s) => s.durationSec)
    expect(workDurations).toEqual([90, 90, 90])
  })

  it('cumulative start/end offsets are correct', () => {
    const segs = expandWorkout(make({
      mode: 'intervals',
      params: { reps: 2, length: { unit: 'm', value: 500 }, rest_sec: 60 },
      warmup_sec: 120,
    }))
    // warmup 120s; work 500m; rest 60s; work 500m
    expect(segs[0].startTimeSec).toBe(0)
    expect(segs[0].endTimeSec).toBe(120)
    expect(segs[1].startDistanceM).toBe(0)
    expect(segs[1].endDistanceM).toBe(500)
    expect(segs[2].startTimeSec).toBe(120)
    expect(segs[2].endTimeSec).toBe(180)
    expect(segs[3].startDistanceM).toBe(500)
    expect(segs[3].endDistanceM).toBe(1000)
  })
})

describe('locateSegment', () => {
  const segs = expandWorkout({
    id: 'W', mode: 'intervals',
    params: { reps: 2, length: { unit: 'm', value: 500 }, rest_sec: 60 },
    warmup_sec: 120, cooldown_sec: 0,
    created_at: '',
  } as Workout)
  // segments: warmup(0-120s), work(0-500m), rest(120-180s), work(500-1000m)

  it('warmup active at zero metrics, full remaining', () => {
    const a = locateSegment(segs, 0, 0, 0)
    expect(a?.segment.kind).toBe('warmup')
    expect(a?.remainingSec).toBe(120)
    expect(a?.progressRatio).toBe(0)
  })

  // REGRESSION (2026-06-11): during warmup work_time_sec is pinned at 0;
  // the countdown must advance against phase_time_sec, not freeze.
  it('warmup counts down against phase time while work time is 0', () => {
    const a = locateSegment(segs, 0, 0, 60)
    expect(a?.segment.kind).toBe('warmup')
    expect(a?.remainingSec).toBe(60)
    expect(a?.progressRatio).toBeCloseTo(0.5)
  })

  it('advances past warmup once the work phase begins', () => {
    // First work strokes: work distance advancing, phase time reset to 0.
    const a = locateSegment(segs, 10, 4, 0)
    expect(a?.segment.kind).toBe('work')
    expect(a?.segment.distanceM).toBe(500)
  })

  it('advances past warmup when phase time exceeds warmup duration', () => {
    const a = locateSegment(segs, 0, 0, 125)
    expect(a?.segment.kind).toBe('work')
  })

  it('remainingM decreases inside distance segment', () => {
    const a = locateSegment(segs, 300, 200, 0)
    expect(a?.segment.kind).toBe('work')
    expect(a?.remainingM).toBe(200)
  })

  it('transitions to rest once work distance consumed', () => {
    const a = locateSegment(segs, 500, 200, 0)
    expect(a?.segment.kind).toBe('rest')
  })

  it('returns null after all segments consumed', () => {
    const a = locateSegment(segs, 1000, 400, 0)
    expect(a).toBeNull()
  })
})

it('empty segments → null', () => {
  expect(locateSegment([], 100, 100, 0)).toBeNull()
})

// REGRESSION (2026-06-12): a time-based work segment following a warmup
// must anchor at work_time_sec = 0 (work time starts when the work phase
// starts), not at the warmup duration — otherwise the countdown freezes
// at full for the warmup's length and overstates remaining throughout.
describe('locateSegment time work after warmup', () => {
  const segs = expandWorkout({
    id: 'W', mode: 'time',
    params: { seconds: 1200 },
    warmup_sec: 120, cooldown_sec: 0,
    created_at: '',
  } as Workout)
  // segments: warmup(120s), work(1200s)

  it('work countdown is full the moment work begins', () => {
    const a = locateSegment(segs, 5, 0, 0)
    expect(a?.segment.kind).toBe('work')
    expect(a?.remainingSec).toBe(1200)
  })

  it('counts down against work time, unskewed by the warmup duration', () => {
    const a = locateSegment(segs, 700, 300, 300)
    expect(a?.segment.kind).toBe('work')
    expect(a?.remainingSec).toBe(900)
    expect(a?.progressRatio).toBeCloseTo(0.25)
  })
})

describe('locateSegment cooldown after distance work', () => {
  function makeSegs() {
    return expandWorkout({
      id: 'w1',
      mode: 'distance',
      params: { meters: 2000 },
      warmup_sec: 60,
      cooldown_sec: 120,
      intensity: undefined,
    } as unknown as Workout)
  }

  it('returns full cooldown remaining at the moment work distance is reached', () => {
    const segs = makeSegs()
    const active = locateSegment(segs, 2000, 600, 0)
    expect(active?.segment.kind).toBe('cooldown')
    expect(active?.remainingSec).toBe(120)
  })

  it('decrements cooldown remaining as time advances after work completion', () => {
    const segs = makeSegs()
    // Prime the anchor at t=600 (work crossed), then observe t=660 (60s later)
    locateSegment(segs, 2000, 600, 0)
    const active = locateSegment(segs, 2000, 660, 0)
    expect(active?.segment.kind).toBe('cooldown')
    expect(active?.remainingSec).toBe(60)
  })

  it('returns null after cooldown elapsed', () => {
    const segs = makeSegs()
    // Prime the anchor at t=600 (work crossed), then observe t=721 (121s later)
    locateSegment(segs, 2000, 600, 0)
    const active = locateSegment(segs, 2000, 721, 0)
    expect(active).toBeNull()
  })
})

// B5: work_distance_m is already offset by the backend (warmup distance
// subtracted). locateSegment receives the pre-offset value directly.
describe('locateSegment with B5 work_distance_m (backend-stamped)', () => {
  function makeSegs() {
    return expandWorkout({
      id: 'w1',
      mode: 'distance',
      params: { meters: 2000 },
      warmup_sec: 60,
      cooldown_sec: 0,
      intensity: undefined,
    } as unknown as Workout)
  }

  it('inside work: remainingM reflects metres remaining of the 2000m goal', () => {
    const segs = makeSegs()
    // 500m of post-warmup work done → 1500m remaining.
    const a = locateSegment(segs, 500, 200, 0)
    expect(a?.segment.kind).toBe('work')
    expect(a?.remainingM).toBe(1500)
  })

  it('crossing fires when 2000m of post-warmup work is completed', () => {
    const segs = makeSegs()
    // 1950m of work → still in work segment.
    const stillWork = locateSegment(segs, 1950, 600, 0)
    expect(stillWork?.segment.kind).toBe('work')
    expect(stillWork?.remainingM).toBe(50)
    // Exactly 2000m of work → completion.
    const done = locateSegment(segs, 2000, 700, 0)
    // No cooldown in this fixture → null is returned at completion.
    expect(done).toBeNull()
  })
})

// phaseplan.go:204-225 — backend has no rest-skip rule; rest persists until
// durationSec elapses regardless of how far the rower has paddled.
describe('rest segments match backend classification (phaseplan.go has no rest-skip)', () => {
  function makeIntervalSegs(): import('./segments').Segment[] {
    // work(0-500m) → rest(60s) → work(500-1000m)
    return [
      {
        kind: 'work',
        index: 0,
        distanceM: 500,
        durationSec: undefined,
        targetSplit: undefined,
        targetSPM: undefined,
        startTimeSec: 0,
        endTimeSec: 0,
        startDistanceM: 0,
        endDistanceM: 500,
      },
      {
        kind: 'rest',
        index: 1,
        durationSec: 60,
        distanceM: undefined,
        targetSplit: undefined,
        targetSPM: undefined,
        startTimeSec: 0,
        endTimeSec: 60,
        startDistanceM: 500,
        endDistanceM: 500,
      },
      {
        kind: 'work',
        index: 2,
        distanceM: 500,
        durationSec: undefined,
        targetSplit: undefined,
        targetSPM: undefined,
        startTimeSec: 60,
        endTimeSec: 60,
        startDistanceM: 500,
        endDistanceM: 1000,
      },
    ]
  }

  it('stays in rest while its duration has not elapsed, even when paddling past the next start', () => {
    const segs = makeIntervalSegs()
    // Latch the crossing at workTimeSec=120 (work_distance_m=500)
    locateSegment(segs, 500, 120, 0)
    // 30s into rest; rower has paddled 30m during rest (work_distance_m=530)
    // next work segment starts at 500m — rower is already past it, but rest (60s) not elapsed
    const active = locateSegment(segs, 530, 150, 0)
    expect(active?.segment.kind).toBe('rest')
    expect(active?.remainingSec).toBe(30)
  })

  it('rest is not skipped on entry (work_distance_m is already offset by backend)', () => {
    const segs = makeIntervalSegs()
    // At workTimeSec=120 the rower crosses 500m of work_distance_m
    locateSegment(segs, 500, 120, 0)
    // 5s later, still in rest — 20m paddled during rest (work_distance_m=520)
    const active = locateSegment(segs, 520, 125, 0)
    expect(active?.segment.kind).toBe('rest')
  })
})
