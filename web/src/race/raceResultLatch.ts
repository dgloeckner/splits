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
  /**
   * Snapshot of the cross stroke at the moment the finish line was
   * crossed. Stored on the latch so render-time observers (StatBar,
   * RaceCanvas via `useRaceFreeze`) can source frozen values from the
   * same immutable record as `FinishOverlay`, preventing batched SSE
   * delivery from snapshotting a later post-horn stroke (0019-02 AC3/AC4).
   *
   * `userDistanceM` is the user's distance at the cross. We render it as
   * `totalMeters` (the line position) because the canvas/StatBar
   * "distance left" UI is defined relative to the line, not the raw
   * stroke sample. `watts` / `spm` / `split` are the cross stroke's
   * instantaneous values when provided by the caller.
   */
  crossSnapshot: {
    userDistanceM: number
    watts: number
    spm: number
    split: number
  }
}

export function computeRaceResultLatch(args: {
  cross: { t: number; dist: number; watts?: number; spm?: number; split?: number }
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

  const crossSnapshot = Object.freeze({
    // The line position, not the (possibly past-line) raw stroke sample.
    userDistanceM: totalMeters,
    watts: cross.watts ?? 0,
    spm: cross.spm ?? 0,
    // Prefer the cross stroke's instantaneous split; fall back to the
    // derived `finalSplitS` (prev → cross pair) so the StatBar never
    // reads zero when the caller omits per-stroke split.
    split: cross.split ?? finalSplitS,
  })

  return Object.freeze({
    finalTimeS,
    finalSplitS,
    gaps: Object.freeze(gaps),
    crossSnapshot,
  }) as RaceResultLatch
}
