import { describe, it, expect } from 'vitest'
import { reconstructDistance, distanceAt } from './distance'

describe('reconstructDistance', () => {
  it('integrates a constant 120 s/500m split correctly', () => {
    const out = reconstructDistance({ tSec: [0, 5, 10], split: [120, 120, 120] })
    expect(out).toHaveLength(3)
    expect(out[0]).toBeCloseTo(0, 5)
    expect(out[1]).toBeCloseTo(20.83333333, 5)
    expect(out[2]).toBeCloseTo(41.66666667, 5)
  })

  it('returns [] for empty input', () => {
    expect(reconstructDistance({ tSec: [], split: [] })).toEqual([])
  })

  it('handles variable split per step', () => {
    const out = reconstructDistance({ tSec: [0, 5, 10], split: [120, 100, 120] })
    expect(out[0]).toBeCloseTo(0, 5)
    // step 1 uses split[1]=100 → (500/100)*5 = 25
    expect(out[1]).toBeCloseTo(25, 5)
    // step 2 uses split[2]=120 → (500/120)*5 ≈ 20.8333; total ≈ 45.8333
    expect(out[2]).toBeCloseTo(45.83333333, 5)
  })

  it('treats zero or negative split as zero velocity (no progress)', () => {
    const out = reconstructDistance({ tSec: [0, 5, 10, 15], split: [120, 0, -50, 120] })
    expect(out[0]).toBeCloseTo(0, 5)
    expect(out[1]).toBeCloseTo(0, 5)
    expect(out[2]).toBeCloseTo(0, 5)
    // last step: (500/120)*5 ≈ 20.8333
    expect(out[3]).toBeCloseTo(20.83333333, 5)
  })
})

describe('distanceAt', () => {
  it('returns 0 for empty series', () => {
    expect(distanceAt({ tSec: [], distM: [] }, 5)).toBe(0)
  })

  it('clamps below first sample to first distance (0 here)', () => {
    expect(distanceAt({ tSec: [0, 5, 10], distM: [0, 25, 50] }, -10)).toBe(0)
  })

  it('clamps above last sample to last distance', () => {
    expect(distanceAt({ tSec: [0, 5, 10], distM: [0, 25, 50] }, 100)).toBe(50)
  })

  it('returns interpolated value strictly between bracketing samples', () => {
    const series = { tSec: [0, 5, 10], distM: [0, 25, 50] }
    const got = distanceAt(series, 2.5)
    expect(got).toBeGreaterThan(0)
    expect(got).toBeLessThan(25)
  })

  it('returns exact knot values at sample points', () => {
    const series = { tSec: [0, 5, 10], distM: [0, 25, 50] }
    expect(distanceAt(series, 0)).toBeCloseTo(0, 9)
    expect(distanceAt(series, 5)).toBeCloseTo(25, 9)
    expect(distanceAt(series, 10)).toBeCloseTo(50, 9)
  })
})
