import { describe, it, expect } from 'vitest'
import { opponentLookup } from './opponentLookup'

// A constant-pace 120 s/500m opponent — 500/120 ≈ 4.1667 m/s
// At t=0 dist=0; at t=60 dist=250; at t=120 dist=500.
const tSec = [0, 60, 120]
const distM = [0, 250, 500]

describe('opponentLookup', () => {
  it('returns userTime - tSec[0] when userDist <= 0 (clamped to start)', () => {
    expect(opponentLookup(tSec, distM, 0, 10)).toBeCloseTo(10, 9)
    expect(opponentLookup(tSec, distM, -50, 5)).toBeCloseTo(5, 9)
  })

  it('returns userTime - tSec[last] when userDist >= last sample', () => {
    expect(opponentLookup(tSec, distM, 500, 100)).toBeCloseTo(100 - 120, 9)
    expect(opponentLookup(tSec, distM, 600, 200)).toBeCloseTo(200 - 120, 9)
  })

  it('returns userTime - tSec[i] at an exact distance match', () => {
    // userDist=250 matches distM[1]=250 → oppTime = 60
    expect(opponentLookup(tSec, distM, 250, 75)).toBeCloseTo(75 - 60, 9)
  })

  it('linearly interpolates oppTime between bracketing samples', () => {
    // userDist=125 → halfway in [0,250] → oppTime = 30
    expect(opponentLookup(tSec, distM, 125, 40)).toBeCloseTo(40 - 30, 9)
    // userDist=375 → halfway in [250,500] → oppTime = 90
    expect(opponentLookup(tSec, distM, 375, 100)).toBeCloseTo(100 - 90, 9)
  })

  it('returns 0 when arrays are too short to look up', () => {
    expect(opponentLookup([], [], 100, 50)).toBe(0)
    expect(opponentLookup([0], [0], 100, 50)).toBe(0)
  })
})
