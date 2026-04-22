import { describe, it, expect } from 'vitest'
import { axisConfig, computeAxis } from './sparklineAxis'

describe('computeAxis', () => {
  it('returns clamp bounds with null data for empty input', () => {
    const b = computeAxis([], 'watts')
    expect(b).toEqual({
      yMin: axisConfig.watts.clampMin,
      yMax: axisConfig.watts.clampMax,
      dataMin: null,
      dataMax: null,
    })
  })

  it('single point → minRange wide, centred on the point (within clamp)', () => {
    const b = computeAxis([200], 'watts')
    expect(b.dataMin).toBe(200)
    expect(b.dataMax).toBe(200)
    // minRange = 100, clamps [0, 600] allow a full-width window centred on 200.
    expect(b.yMax - b.yMin).toBeCloseTo(100, 9)
    expect(b.yMin).toBeCloseTo(150, 9)
    expect(b.yMax).toBeCloseTo(250, 9)
  })

  it('flat line (all equal) → minRange wide, centred (clamped)', () => {
    const b = computeAxis([150, 150, 150, 150], 'watts')
    expect(b.dataMin).toBe(150)
    expect(b.dataMax).toBe(150)
    expect(b.yMin).toBeCloseTo(100, 9)
    expect(b.yMax).toBeCloseTo(200, 9)
  })

  it('range within minRange → minRange wide, centred', () => {
    const b = computeAxis([180, 200, 210], 'watts')
    // range = 30, 30*1.2 = 36 < minRange 100 → use 100
    expect(b.dataMin).toBe(180)
    expect(b.dataMax).toBe(210)
    expect(b.yMax - b.yMin).toBeCloseTo(100, 9)
    // centre = 195
    expect(b.yMin).toBeCloseTo(145, 9)
    expect(b.yMax).toBeCloseTo(245, 9)
  })

  it('range exceeds min → range * 1.2, centred', () => {
    const b = computeAxis([100, 300], 'watts')
    // range 200, desired = 240, centre = 200
    expect(b.yMin).toBeCloseTo(80, 9)
    expect(b.yMax).toBeCloseTo(320, 9)
    expect(b.dataMin).toBe(100)
    expect(b.dataMax).toBe(300)
  })

  it('clamp low: centre below clamp floor → yMin = clampMin (no yMax expansion)', () => {
    // dps clampMin = 0, minRange = 4; values [1,2] → centre 1.5, desired 4
    // → yMin = -0.5 → clamped to 0; yMax stays at 3.5
    const b = computeAxis([1, 2], 'dps')
    expect(b.yMin).toBe(0)
    expect(b.yMax).toBeCloseTo(3.5, 9)
  })

  it('clamp high: centre above clamp ceiling → yMax = clampMax (no yMin expansion)', () => {
    // watts clampMax = 600; values [590, 595] → centre 592.5, desired 100
    // → yMax = 642.5 → clamped to 600; yMin stays at 542.5
    const b = computeAxis([590, 595], 'watts')
    expect(b.yMax).toBe(600)
    expect(b.yMin).toBeCloseTo(542.5, 9)
  })

  it('clamp both: wide range outside clamp window → yMin = clampMin, yMax = clampMax', () => {
    // spm clamp [0, 50], minRange 10; values [-10, 70] → centre 30, desired 96
    // → yMin = -18 → 0; yMax = 78 → 50
    const b = computeAxis([-10, 70], 'spm')
    expect(b.yMin).toBe(0)
    expect(b.yMax).toBe(50)
    expect(b.dataMin).toBe(-10)
    expect(b.dataMax).toBe(70)
  })
})
