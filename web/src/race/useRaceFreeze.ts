import { useRef } from 'react'
import type { LiveState } from '../live/reducer'
import type { RaceResultLatch } from './raceResultLatch'
import { opponentLookup } from './opponentLookup'

export type RaceFreezeOpponentCurve = { tSec: number[]; distM: number[] }

export type RaceFreezeOpponents = {
  ghost?: RaceFreezeOpponentCurve
  pb?: RaceFreezeOpponentCurve
}

export type RaceFreezeValues = {
  elapsedSec: number
  userDistanceM: number
  split: number
  watts: number
  spm: number
  ghostGap: number | null
  pbGap: number | null
  /** True once the finish-horn snapshot has been captured. */
  frozen: boolean
}

type Args = {
  liveState: LiveState
  totalMeters: number
  opponents: RaceFreezeOpponents
  /**
   * Authoritative finish-line latch from the `raceLifecycle` reducer.
   * When non-null, `useRaceFreeze` sources every output field from this
   * record so the StatBar / Canvas freeze on the *same* stroke as the
   * FinishOverlay — even when React batches multiple post-horn SSE
   * strokes into a single commit (0019-02 AC3/AC4).
   *
   * Pre-horn (`null`) the hook falls back to passing the live stroke's
   * values through, unchanged from earlier behaviour.
   */
  latchedResult?: RaceResultLatch | null
}

/**
 * Single source of truth for the race surface's render inputs from the
 * finish horn onward (PRD-0019 §Frozen race surface).
 *
 * Before the horn: passes the live stroke values through, computing
 * `ghostGap` / `pbGap` against the current `(elapsedSec, userDistanceM)`.
 * After the horn: returns the immutable snapshot stored on
 * `latchedResult` by the `raceLifecycle` reducer. This is the same
 * record `FinishOverlay` renders from, guaranteeing cross-component
 * consistency.
 *
 * Note: we deliberately do NOT re-snapshot the live stroke at render
 * time. React can batch several SSE strokes into one commit, in which
 * case `liveState.stroke` is already a post-horn stroke by the time the
 * hook runs. Sourcing the frozen values from the per-event reducer
 * (which sees every stroke individually) is the architectural fix.
 */
export function useRaceFreeze({
  liveState,
  totalMeters,
  opponents,
  latchedResult,
}: Args): RaceFreezeValues {
  // Fallback snapshot for callers that don't plumb `latchedResult`
  // (e.g. older unit tests that render `RaceLiveView` standalone). When
  // `latchedResult` is provided it always wins — the ref is only the
  // safety net for the unplumbed path.
  const fallbackRef = useRef<RaceFreezeValues | null>(null)

  if (latchedResult) {
    const { finalTimeS, gaps, crossSnapshot } = latchedResult
    return {
      elapsedSec: finalTimeS,
      userDistanceM: crossSnapshot.userDistanceM,
      split: crossSnapshot.split,
      watts: crossSnapshot.watts,
      spm: crossSnapshot.spm,
      ghostGap: gaps.ghost ?? null,
      pbGap: gaps.pb ?? null,
      frozen: true,
    }
  }

  if (fallbackRef.current) return fallbackRef.current

  const stroke = liveState.stroke
  const elapsedSec = stroke?.time_sec ?? 0
  const userDistanceM = stroke?.distance_m ?? 0
  const split = stroke?.pace_sec_per_500m ?? 120
  const watts = stroke?.power_w ?? 0
  const spm = stroke?.spm ?? 0

  const ghostGap = opponents.ghost
    ? opponentLookup(opponents.ghost.tSec, opponents.ghost.distM, userDistanceM, elapsedSec)
    : null
  const pbGap = opponents.pb
    ? opponentLookup(opponents.pb.tSec, opponents.pb.distM, userDistanceM, elapsedSec)
    : null

  // No latch yet, but the live stroke already shows the user past the
  // line. This can happen for one render between (a) the live reducer
  // committing the cross stroke and (b) the race-lifecycle effect
  // dispatching that stroke to the lifecycle reducer. In that window we
  // still need to freeze (rather than show a moving sprite), so we
  // build a transient frozen view from the live stroke. Once the
  // lifecycle reducer's `latchedResult` arrives on the next commit the
  // hook switches to it — and the two snapshots are tied to the same
  // stroke by `RaceFlow`'s effect, so the user sees no visual jump.
  if (stroke != null && userDistanceM >= totalMeters) {
    const snapshot: RaceFreezeValues = Object.freeze({
      elapsedSec,
      userDistanceM,
      split,
      watts,
      spm,
      ghostGap,
      pbGap,
      frozen: true,
    })
    fallbackRef.current = snapshot
    return snapshot
  }

  return { elapsedSec, userDistanceM, split, watts, spm, ghostGap, pbGap, frozen: false }
}
