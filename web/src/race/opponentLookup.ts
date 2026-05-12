/**
 * Direct distance-lookup helper for race opponent gap computation.
 *
 * Given parallel `t_sec[]` and `distance_m[]` arrays (monotone non-decreasing,
 * `t_sec[0] === 0`) and the user's `(distance, time)` pair, return the signed
 * gap in seconds: positive when the user is *behind* the opponent (took more
 * time to reach `userDist`), negative when ahead.
 *
 * Edge cases:
 *  - empty / single-sample arrays → returns 0 (insufficient data)
 *  - `userDist <= distM[0]` → uses `tSec[0]` as opponent time at that distance
 *  - `userDist >= distM[last]` → opponent already finished; uses `tSec[last]`
 *  - exact match at a sample → uses that sample's `tSec`
 *  - otherwise → linear interpolation in time between the bracketing samples
 *
 * Uses binary search by distance — no on-each-frame integration.
 */
export function opponentLookup(
  tSec: number[],
  distM: number[],
  userDist: number,
  userTime: number,
): number {
  const n = tSec.length
  if (n < 2 || distM.length < 2) return 0
  if (userDist <= distM[0]) return userTime - tSec[0]
  if (userDist >= distM[n - 1]) return userTime - tSec[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (distM[mid] <= userDist) lo = mid
    else hi = mid
  }
  const span = distM[hi] - distM[lo]
  const oppTime =
    span <= 0
      ? tSec[lo]
      : tSec[lo] + ((userDist - distM[lo]) / span) * (tSec[hi] - tSec[lo])
  return userTime - oppTime
}
