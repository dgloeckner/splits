import { describe, it, expect } from 'vitest'
import type { RaceOpponent } from '../api/race'
import { opponentTimeAtDistance, gapAtFinish } from './raceFinish'

function constantPaceOpp(splitSec: number, durationSec: number, stepSec = 1): RaceOpponent {
  const tSec: number[] = []
  const split: number[] = []
  for (let t = 0; t <= durationSec; t += stepSec) {
    tSec.push(t)
    split.push(splitSec)
  }
  return { sourceSessionId: 's', label: 'pb', tSec, split }
}

describe('opponentTimeAtDistance', () => {
  it('returns 24s at 100 m for a constant 120 s/500m pace', () => {
    // v = 500/120 m/s ≈ 4.1667 m/s → 100 m in 24 s exactly.
    const opp = constantPaceOpp(120, 60)
    expect(opponentTimeAtDistance(opp, 100)).toBeCloseTo(24.0, 5)
  })

  it('clamps below first sample to tSec[0]', () => {
    const opp: RaceOpponent = {
      sourceSessionId: 's',
      label: 'pb',
      tSec: [0, 1, 2],
      split: [120, 120, 120],
    }
    expect(opponentTimeAtDistance(opp, -10)).toBe(0)
  })

  it('clamps above last sample to tSec[last]', () => {
    const opp = constantPaceOpp(120, 10)
    const last = opp.tSec[opp.tSec.length - 1]
    expect(opponentTimeAtDistance(opp, 1_000_000)).toBe(last)
  })

  it('returns 0 for an empty series', () => {
    const opp: RaceOpponent = { sourceSessionId: 's', label: 'pb', tSec: [], split: [] }
    expect(opponentTimeAtDistance(opp, 100)).toBe(0)
  })
})

describe('gapAtFinish', () => {
  it('returns positive when the user is slower than the opponent', () => {
    const opp = constantPaceOpp(120, 60) // reaches 100 m at t=24s
    // User reaches 100 m at t=30s → gap = +6.
    expect(gapAtFinish(opp, 100, 30)).toBeCloseTo(6, 5)
  })

  it('returns negative when the user is faster than the opponent', () => {
    const opp = constantPaceOpp(120, 60) // reaches 100 m at t=24s
    // User reaches 100 m at t=20s → gap = -4.
    expect(gapAtFinish(opp, 100, 20)).toBeCloseTo(-4, 5)
  })
})
