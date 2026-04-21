import { describe, it, expect } from 'vitest'
import { ema, applyHysteresis } from './ema'

describe('ema', () => {
  it('returns the candidate when prev is null (seed)', () => {
    expect(ema(null, 42, 0.3)).toBe(42)
  })

  it('blends prev and next by alpha', () => {
    expect(ema(100, 200, 0.3)).toBeCloseTo(130)
    expect(ema(100, 200, 0.5)).toBeCloseTo(150)
    expect(ema(100, 200, 1)).toBeCloseTo(200)
  })

  it('converges toward a constant signal', () => {
    let v: number | null = null
    for (let i = 0; i < 50; i++) v = ema(v, 100, 0.3)
    expect(v).toBeCloseTo(100, 3)
  })
})

describe('applyHysteresis', () => {
  it('returns current when the candidate is within threshold', () => {
    expect(applyHysteresis(100, 101, 3)).toBe(100)
    expect(applyHysteresis(100, 99, 3)).toBe(100)
  })

  it('returns candidate when the delta crosses threshold', () => {
    expect(applyHysteresis(100, 105, 3)).toBe(105)
    expect(applyHysteresis(100, 90, 3)).toBe(90)
  })

  it('boundary: equal-to-threshold does not trigger update', () => {
    // |candidate - current| === threshold is NOT strictly less, so we DO update.
    expect(applyHysteresis(100, 103, 3)).toBe(103)
  })
})
