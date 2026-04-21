import { describe, it, expect } from 'vitest'
import { computeBMI } from './bmi'

describe('computeBMI', () => {
  it('returns null if inputs missing', () => {
    expect(computeBMI(undefined, 170)).toBeNull()
    expect(computeBMI(70, undefined)).toBeNull()
    expect(computeBMI(undefined, undefined)).toBeNull()
  })
  it('returns null if height is zero', () => {
    expect(computeBMI(70, 0)).toBeNull()
  })
  it('computes BMI rounded to 1 decimal', () => {
    expect(computeBMI(70, 172)).toBeCloseTo(23.7, 1)
    expect(computeBMI(80, 180)).toBeCloseTo(24.7, 1)
  })
})
