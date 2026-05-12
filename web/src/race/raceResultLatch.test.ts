import { describe, it, expect } from 'vitest'
import { computeRaceResultLatch } from './raceResultLatch'

// Constant-pace 120 s/500m opponent — at t=0 dist=0, t=60 dist=250, t=120 dist=500.
const ghost = { tSec: [0, 60, 120, 240, 480], distM: [0, 250, 500, 1000, 2000] }
// Slightly faster PB: 110 s/500m → 440 s at 2000 m.
const pb = { tSec: [0, 55, 110, 220, 440], distM: [0, 250, 500, 1000, 2000] }

describe('computeRaceResultLatch', () => {
  it('cross exactly at totalMeters: finalTimeS from cross stroke, split from last 2 strokes', () => {
    const r = computeRaceResultLatch({
      cross: { t: 470, dist: 2000 },
      prev: { t: 460, dist: 1958 }, // last 42 m in 10 s → split = 10*500/42 ≈ 119.05
      totalMeters: 2000,
      opponents: { ghost, pb },
    })
    expect(r.finalTimeS).toBeCloseTo(470, 9)
    expect(r.finalSplitS).toBeCloseTo((10 * 500) / 42, 6)
    // Ghost finished at 480 → user at 470 is 10 s ahead → gap = -10
    expect(r.gaps.ghost).toBeCloseTo(-10, 6)
    // PB finished at 440 → user at 470 is 30 s behind → gap = +30
    expect(r.gaps.pb).toBeCloseTo(30, 6)
  })

  it('cross between samples (totalMeters between ghost samples)', () => {
    // user crosses 1500m at t=350
    const r = computeRaceResultLatch({
      cross: { t: 350, dist: 1500 },
      prev: { t: 340, dist: 1460 },
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
      prev: { t: 460, dist: 1958 },
      totalMeters: 2000,
      opponents: { ghost },
    })
    expect(r.gaps.ghost).toBeCloseTo(-10, 6)
    expect(r.gaps.pb).toBeUndefined()
  })

  it('pb-only present', () => {
    const r = computeRaceResultLatch({
      cross: { t: 470, dist: 2000 },
      prev: { t: 460, dist: 1958 },
      totalMeters: 2000,
      opponents: { pb },
    })
    expect(r.gaps.pb).toBeCloseTo(30, 6)
    expect(r.gaps.ghost).toBeUndefined()
  })

  it('neither opponent present', () => {
    const r = computeRaceResultLatch({
      cross: { t: 470, dist: 2000 },
      prev: { t: 460, dist: 1958 },
      totalMeters: 2000,
      opponents: {},
    })
    expect(r.gaps.ghost).toBeUndefined()
    expect(r.gaps.pb).toBeUndefined()
    expect(r.finalTimeS).toBe(470)
  })

  it('without prev stroke, derives split from cross pair (dist, t)', () => {
    // No previous stroke — fall back to overall pace 500*t/dist
    const r = computeRaceResultLatch({
      cross: { t: 470, dist: 2000 },
      prev: null,
      totalMeters: 2000,
      opponents: {},
    })
    expect(r.finalSplitS).toBeCloseTo((470 * 500) / 2000, 6)
  })
})
