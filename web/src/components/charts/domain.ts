// Y-domain of the session-detail charts: the working range of the
// piece, not min/max of every point. The start-up bucket (pace from
// standstill) and the overrun after the goal would otherwise stretch
// the axis until the real pacing is a few pixels tall (#43).

export type XRange = { fromX: number; toX: number }
export type YRange = { min: number; max: number }

/** Share of points trimmed at each end when no analysis window exists. */
export const TRIM_FRACTION = 0.05
/** Padding added on both sides of a trimmed range, as a share of its span. */
export const TRIM_PADDING = 0.25

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * Trimmed fallback range: the 5th to 95th percentile of the values,
 * padded by a quarter of that span on each side, never beyond the
 * actual min/max. The padding keeps genuine pacing near the edges of
 * the distribution (a sprint, a step change) inside the domain; only
 * the few points far outside it are clipped.
 */
export function trimmedRange(ys: number[]): YRange | null {
  const vals = ys.filter(Number.isFinite).sort((a, b) => a - b)
  if (vals.length === 0) return null
  const lo = quantile(vals, TRIM_FRACTION)
  const hi = quantile(vals, 1 - TRIM_FRACTION)
  const pad = (hi - lo) * TRIM_PADDING
  return {
    min: Math.max(vals[0], lo - pad),
    max: Math.min(vals[vals.length - 1], hi + pad),
  }
}

/**
 * Working y-range of a chart. With an analysis window (as an x-range)
 * it is min/max of the points inside the window; without one, or when
 * the window holds no point, the trimmed range of all points.
 */
export function workingYRange(points: { x: number; y: number }[], focus?: XRange | null): YRange | null {
  if (focus) {
    const inside = points.filter((p) => p.x >= focus.fromX && p.x <= focus.toX && Number.isFinite(p.y))
    if (inside.length > 0) {
      const ys = inside.map((p) => p.y)
      return { min: Math.min(...ys), max: Math.max(...ys) }
    }
  }
  return trimmedRange(points.map((p) => p.y))
}

/** Clamp a value into [min, max] so points outside the domain sit on the plot edge. */
export function clampY(y: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, y))
}
