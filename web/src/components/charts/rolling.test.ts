import { describe, it, expect } from 'vitest'
import { rangeRollingWindowDays, rollingAverage } from './rolling'

describe('rangeRollingWindowDays', () => {
  it('returns the documented per-window window', () => {
    expect(rangeRollingWindowDays('30d')).toBe(14)
    expect(rangeRollingWindowDays('365d')).toBe(30)
    expect(rangeRollingWindowDays('all')).toBe(90)
  })
})

describe('rollingAverage', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('returns [] for empty input', () => {
    expect(rollingAverage([], 14)).toEqual([])
  })

  it('returns the single point unchanged for one input', () => {
    const points = [{ t: 0, y: 10 }]
    expect(rollingAverage(points, 14)).toEqual([{ t: 0, y: 10 }])
  })

  it('computes a trailing-window mean over evenly spaced points', () => {
    const points = [
      { t: 0 * DAY, y: 10 },
      { t: 1 * DAY, y: 12 },
      { t: 2 * DAY, y: 14 },
      { t: 3 * DAY, y: 16 },
      { t: 4 * DAY, y: 18 },
    ]
    const out = rollingAverage(points, 3)
    // Inclusive trailing window — a point exactly windowDays ago IS
    // included (matches the "14-d Ø" mental model where "last 14 days"
    // includes day -14). Same semantics as the "boundary inclusive"
    // test below.
    // At t=0: point 0 → 10
    // At t=1: points 0,1 → (10+12)/2 = 11
    // At t=2: points 0,1,2 → (10+12+14)/3 = 12
    // At t=3: points 0,1,2,3 (window [0,3] is 3 days, all 4 included) → (10+12+14+16)/4 = 13
    // At t=4: points 1,2,3,4 (window [1,4]) → (12+14+16+18)/4 = 15
    expect(out.map((p) => p.y)).toEqual([10, 11, 12, 13, 15])
    expect(out.map((p) => p.t)).toEqual(points.map((p) => p.t))
  })

  it('handles a window longer than the data span', () => {
    const points = [
      { t: 0, y: 10 },
      { t: DAY, y: 20 },
    ]
    expect(rollingAverage(points, 365)).toEqual([
      { t: 0, y: 10 },
      { t: DAY, y: 15 },
    ])
  })

  it('uses a strictly trailing window (boundary inclusive)', () => {
    const points = [
      { t: 0, y: 100 },
      { t: 14 * DAY, y: 200 },
    ]
    expect(rollingAverage(points, 14)).toEqual([
      { t: 0, y: 100 },
      { t: 14 * DAY, y: 150 },
    ])
  })
})
