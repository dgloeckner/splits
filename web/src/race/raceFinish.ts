import { reconstructDistance } from './distance'
import type { RaceOpponent } from '../api/race'

/**
 * Returns the time (in seconds) at which the opponent reached
 * `targetDistance`, by inverse linear interpolation across the
 * opponent's reconstructed distance series.
 *
 * If `targetDistance` is below the first sample's distance, returns
 * the first sample's `tSec`. If above the last, returns the last
 * sample's `tSec`. For an empty series, returns 0.
 */
export function opponentTimeAtDistance(opp: RaceOpponent, targetDistance: number): number {
  const tSec = opp.tSec
  const n = tSec.length
  if (n === 0) return 0
  const distM = reconstructDistance({ tSec, split: opp.split })
  if (n === 1) return tSec[0]
  if (targetDistance <= distM[0]) return tSec[0]
  if (targetDistance >= distM[n - 1]) return tSec[n - 1]
  // Binary-search the bracket where distM[i] <= target <= distM[i+1].
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (distM[mid] <= targetDistance) lo = mid
    else hi = mid
  }
  const d0 = distM[lo]
  const d1 = distM[lo + 1]
  const t0 = tSec[lo]
  const t1 = tSec[lo + 1]
  if (d1 === d0) return t0
  return t0 + ((targetDistance - d0) / (d1 - d0)) * (t1 - t0)
}

/**
 * Returns the seconds-gap between the user and the opponent at the
 * point where both have covered `userDistanceM`. Positive = user
 * took longer (user is behind). Negative = user finished faster.
 */
export function gapAtFinish(
  opp: RaceOpponent,
  userDistanceM: number,
  userElapsedSec: number,
): number {
  const oppTime = opponentTimeAtDistance(opp, userDistanceM)
  return userElapsedSec - oppTime
}
