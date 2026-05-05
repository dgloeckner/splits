import { useEffect, useRef, useState } from 'react'
import type { LiveState } from '../live/reducer'
import type { RaceOpponentsResponse } from '../api/race'
import type { RaceResult } from './RaceResultToast'
import { gapAtFinish } from './raceFinish'

/**
 * Watches `liveState.summary` for the null → set transition. On that
 * transition (and only when `aborted` is false), computes the finish
 * gaps versus PB and Ghost and stores them as a {@link RaceResult}.
 *
 * Returns null until a real (non-aborted) finish occurs. When the
 * summary clears (next session begins), the result is reset to null.
 */
export function useRaceFinish(args: {
  liveState: LiveState
  opponents: RaceOpponentsResponse
  aborted: boolean
}): RaceResult | null {
  const { liveState, opponents, aborted } = args
  const summary = liveState.summary
  const prevSummaryRef = useRef<typeof summary>(null)
  const [result, setResult] = useState<RaceResult | null>(null)

  useEffect(() => {
    const prev = prevSummaryRef.current
    if (!prev && summary) {
      if (!aborted) {
        const userDistanceM = summary.total_distance_m
        const userElapsedSec = summary.total_time_sec
        const vsPbSec = opponents.pb
          ? gapAtFinish(opponents.pb, userDistanceM, userElapsedSec)
          : null
        const vsGhostSec = opponents.ghost
          ? gapAtFinish(opponents.ghost, userDistanceM, userElapsedSec)
          : null
        setResult({ vsPbSec, vsGhostSec })
      }
    } else if (prev && !summary) {
      // New session: reset.
      setResult(null)
    }
    prevSummaryRef.current = summary
  }, [summary, aborted, opponents.pb, opponents.ghost])

  return result
}
