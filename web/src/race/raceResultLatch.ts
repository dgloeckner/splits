/**
 * Pure helper that latches the user's race result at the finish-cross
 * stroke. Returns an immutable `{ finalTimeS, finalSplitS, gaps }`
 * snapshot — once computed it does not recompute even if more strokes
 * arrive. The reducer stores this snapshot on its `Finished` state
 * (see `raceLifecycle.ts` and PRD-0014 §Finish horn).
 *
 * Assumptions:
 *  - `cross` is the stroke at which `dist >= totalMeters`. We use its
 *    `t` directly as `finalTimeS` (we do NOT interpolate down to
 *    exactly `totalMeters`; the stroke that crosses the line *is* the
 *    finish stroke for the user).
 *  - `prev` is the previous stroke if available. When present we
 *    derive the final split from the (prev → cross) pair:
 *    `500 * (t - prevT) / (dist - prevDist)`. When `prev` is null
 *    (first stroke happens to cross), we fall back to the overall
 *    average pace `500 * t / dist`.
 *  - Opponent arrays follow `opponentLookup` conventions: monotone,
 *    `t_sec[0] === 0`. We compute the gap at `totalMeters` (the line),
 *    using the user's `finalTimeS` as the user-time.
 */
import { opponentLookup } from './opponentLookup'

export type LatchOpponentCurve = { tSec: number[]; distM: number[] }

export type RaceResultLatch = {
  finalTimeS: number
  finalSplitS: number
  gaps: { ghost?: number; pb?: number }
}

export function computeRaceResultLatch(args: {
  cross: { t: number; dist: number }
  prev: { t: number; dist: number } | null
  totalMeters: number
  opponents: { ghost?: LatchOpponentCurve; pb?: LatchOpponentCurve }
}): RaceResultLatch {
  const { cross, prev, totalMeters, opponents } = args
  const finalTimeS = cross.t

  let finalSplitS = 0
  if (prev && cross.dist > prev.dist && cross.t > prev.t) {
    finalSplitS = (500 * (cross.t - prev.t)) / (cross.dist - prev.dist)
  } else if (cross.dist > 0 && cross.t > 0) {
    finalSplitS = (500 * cross.t) / cross.dist
  }

  const gaps: { ghost?: number; pb?: number } = {}
  if (opponents.ghost) {
    gaps.ghost = opponentLookup(
      opponents.ghost.tSec,
      opponents.ghost.distM,
      totalMeters,
      finalTimeS,
    )
  }
  if (opponents.pb) {
    gaps.pb = opponentLookup(
      opponents.pb.tSec,
      opponents.pb.distM,
      totalMeters,
      finalTimeS,
    )
  }

  return Object.freeze({ finalTimeS, finalSplitS, gaps: Object.freeze(gaps) }) as RaceResultLatch
}
