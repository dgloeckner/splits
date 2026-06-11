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
 *  - `finalSplitS` is the **race-average split (Schnitt)**:
 *    `(500 × finalTimeS) / totalMeters`. This is the universally
 *    meaningful summary number for a completed race — see
 *    CONTEXT.md §Race average split (Schnitt). It is intentionally
 *    *not* the last-segment (prev → cross) value, which is esoteric
 *    and confusingly close to the StatBar's instantaneous Live split.
 *    `prev` is accepted for backward-compatibility with callers but
 *    is no longer used in the split derivation.
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
  totalMeters: number
  opponents: { ghost?: LatchOpponentCurve; pb?: LatchOpponentCurve }
}): RaceResultLatch {
  const { cross, totalMeters, opponents } = args
  const finalTimeS = cross.t

  // Race-average split (Schnitt): (500 × race_time) / race_distance.
  // Single source of truth for the FinishOverlay summary number.
  const finalSplitS =
    totalMeters > 0 && finalTimeS > 0 ? (500 * finalTimeS) / totalMeters : 0

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
    // WHY: prefer the cross stroke's instantaneous IPM split. The
    // fallback is degenerate in practice — IPM strokes always carry
    // `pace_sec_per_500m` — but if ever absent we'd rather show the
    // race-average Schnitt than zero. The StatBar label still reads
    // "Split"; the value just won't be instantaneous in that edge case.
    split: cross.split ?? finalSplitS,
  })

  return Object.freeze({
    finalTimeS,
    finalSplitS,
    gaps: Object.freeze(gaps),
    crossSnapshot,
  }) as RaceResultLatch
}
