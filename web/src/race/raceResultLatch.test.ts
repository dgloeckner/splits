import { describe, it, expect } from 'vitest'
import { computeRaceResultLatch } from './raceResultLatch'

// Constant-pace 120 s/500m opponent — at t=0 dist=0, t=60 dist=250, t=120 dist=500.
const ghost = { tSec: [0, 60, 120, 240, 480], distM: [0, 250, 500, 1000, 2000] }
// Slightly faster PB: 110 s/500m → 440 s at 2000 m.
const pb = { tSec: [0, 55, 110, 220, 440], distM: [0, 250, 500, 1000, 2000] }

describe('computeRaceResultLatch', () => {
  // 0019-07: finalSplitS is now the race-average split (Schnitt):
  // (500 × finalTimeS) / totalMeters — independent of the last-segment
  // (prev → cross) pair. See CONTEXT.md §Race average split (Schnitt).
  it('finalSplitS is race-average Schnitt: 500 m in 100 s → 100.0 s/500m', () => {
    // Per CONTEXT.md §Race average split (Schnitt):
    // Schnitt = (500 × race_time) / race_distance.
    // For a 500 m race in 100 s: (500*100)/500 = 100.0 s/500m.
    // (The issue text floated "250.0" but its own formula yields 100.0;
    // we honour the formula — the universally-meaningful summary number.)
    const r = computeRaceResultLatch({
      cross: { t: 100, dist: 500 },
      totalMeters: 500,
      opponents: {},
    })
    expect(r.finalSplitS).toBeCloseTo(100.0, 9)
  })

  it('finalSplitS is race-average Schnitt: 1000 m in 500 s → 250.0 s/500m', () => {
    // Sanity case where Schnitt and race_time visibly differ.
    const r = computeRaceResultLatch({
      cross: { t: 500, dist: 1000 },
      totalMeters: 1000,
      opponents: {},
    })
    expect(r.finalSplitS).toBeCloseTo(250.0, 9)
  })

  it('cross exactly at totalMeters: finalTimeS from cross stroke, split is race-average', () => {
    const r = computeRaceResultLatch({
      cross: { t: 470, dist: 2000 },
      totalMeters: 2000,
      opponents: { ghost, pb },
    })
    expect(r.finalTimeS).toBeCloseTo(470, 9)
    // Schnitt = 500 * 470 / 2000 = 117.5
    expect(r.finalSplitS).toBeCloseTo((500 * 470) / 2000, 6)
    // Ghost finished at 480 → user at 470 is 10 s ahead → gap = -10
    expect(r.gaps.ghost).toBeCloseTo(-10, 6)
    // PB finished at 440 → user at 470 is 30 s behind → gap = +30
    expect(r.gaps.pb).toBeCloseTo(30, 6)
  })

  it('cross between samples (totalMeters between ghost samples)', () => {
    // user crosses 1500m at t=350
    const r = computeRaceResultLatch({
      cross: { t: 350, dist: 1500 },
      totalMeters: 1500,
      opponents: { ghost },
    })
    expect(r.finalTimeS).toBeCloseTo(350, 9)
    // Ghost at 1500 m: between (240, 1000) and (480, 2000): interp 240 + 0.5*240 = 360
    // gap = 350 - 360 = -10
    expect(r.gaps.ghost).toBeCloseTo(-10, 6)
    expect(r.gaps.pb).toBeUndefined()
  })

  it('ghost-only present', () => {
    const r = computeRaceResultLatch({
      cross: { t: 470, dist: 2000 },
      totalMeters: 2000,
      opponents: { ghost },
    })
    expect(r.gaps.ghost).toBeCloseTo(-10, 6)
    expect(r.gaps.pb).toBeUndefined()
  })

  it('pb-only present', () => {
    const r = computeRaceResultLatch({
      cross: { t: 470, dist: 2000 },
      totalMeters: 2000,
      opponents: { pb },
    })
    expect(r.gaps.pb).toBeCloseTo(30, 6)
    expect(r.gaps.ghost).toBeUndefined()
  })

  it('neither opponent present', () => {
    const r = computeRaceResultLatch({
      cross: { t: 470, dist: 2000 },
      totalMeters: 2000,
      opponents: {},
    })
    expect(r.gaps.ghost).toBeUndefined()
    expect(r.gaps.pb).toBeUndefined()
    expect(r.finalTimeS).toBe(470)
  })

  it('without prev stroke, still race-average over totalMeters', () => {
    const r = computeRaceResultLatch({
      cross: { t: 470, dist: 2000 },
      totalMeters: 2000,
      opponents: {},
    })
    // Schnitt is invariant of prev: 500 * 470 / 2000
    expect(r.finalSplitS).toBeCloseTo((470 * 500) / 2000, 6)
  })
})
