import type { ActiveSegment } from '../../live/segments'
import { useLiveSession } from '../../live/LiveSessionContext'
import { useExtrapolatedDistanceM, useExtrapolatedTimeSec } from '../../live/useLiveDisplay'

/**
 * Returns an ActiveSegment whose remainingSec / remainingM / progressRatio
 * are recomputed from the dead-reckoned extrapolated time/distance, so
 * countdowns and the progress marker tick smoothly between strokes.
 */
export function useExtrapolatedActiveSegment(active: ActiveSegment | null): ActiveSegment | null {
  const state = useLiveSession()
  const extT = useExtrapolatedTimeSec(state)
  const extD = useExtrapolatedDistanceM(state)
  if (!active) return null
  const seg = active.segment
  const stroke = state.stroke
  if (seg.durationSec != null && extT.value != null && stroke != null) {
    // Subtract elapsed time since last stroke from the stamped remaining.
    const extraDelta = Math.max(0, extT.value - stroke.time_sec)
    const remaining = Math.max(0, (active.remainingSec ?? 0) - extraDelta)
    const elapsed = seg.durationSec - remaining
    return { ...active, remainingSec: remaining, progressRatio: Math.min(1, elapsed / seg.durationSec) }
  }
  if (seg.distanceM != null && extD.value != null && stroke != null) {
    // Dead-reckon phase_distance_m: add the distance-extrapolation delta on top.
    const phaseDistM = stroke.phase_distance_m + Math.max(0, extD.value - stroke.distance_m)
    const consumed = Math.max(0, phaseDistM - seg.startDistanceM)
    const remaining = Math.max(0, seg.distanceM - consumed)
    return { ...active, remainingM: remaining, progressRatio: Math.min(1, consumed / seg.distanceM) }
  }
  return active
}
