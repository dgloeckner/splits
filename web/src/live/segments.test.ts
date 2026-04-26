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

  it('returns first segment at zero metrics', () => {
    const a = locateSegment(segs, 0, 0)
    expect(a?.segment.kind).toBe('warmup')
    expect(a?.progressRatio).toBe(0)
    expect(a?.remainingSec).toBe(120)
  })

  it('advances to work after warmup time consumed', () => {
    const a = locateSegment(segs, 0, 120)
    expect(a?.segment.kind).toBe('work')
    expect(a?.segment.distanceM).toBe(500)
  })

  it('remainingM decreases inside distance segment', () => {
    const a = locateSegment(segs, 300, 200)
    expect(a?.segment.kind).toBe('work')
    expect(a?.remainingM).toBe(200)
  })

  it('transitions to rest once work distance consumed', () => {
    const a = locateSegment(segs, 500, 200)
    expect(a?.segment.kind).toBe('rest')
  })

  it('returns null after all segments consumed', () => {
    const a = locateSegment(segs, 1000, 400)
    expect(a).toBeNull()
  })

  it('empty segments → null', () => {
    expect(locateSegment([], 100, 100)).toBeNull()
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
    const active = locateSegment(segs, 2000, 600)
    expect(active?.segment.kind).toBe('cooldown')
    expect(active?.remainingSec).toBe(120)
  })

  it('decrements cooldown remaining as time advances after work completion', () => {
    const segs = makeSegs()
    // Prime the anchor at t=600 (work crossed), then observe t=660 (60s later)
    locateSegment(segs, 2000, 600)
    const active = locateSegment(segs, 2000, 660)
    expect(active?.segment.kind).toBe('cooldown')
    expect(active?.remainingSec).toBe(60)
  })

  it('returns null after cooldown elapsed', () => {
    const segs = makeSegs()
    // Prime the anchor at t=600 (work crossed), then observe t=721 (121s later)
    locateSegment(segs, 2000, 600)
    const active = locateSegment(segs, 2000, 721)
    expect(active).toBeNull()
  })
})
