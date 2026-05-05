export type Samples = { tSec: number[]; split: number[] }
export type DistanceSeries = { tSec: number[]; distM: number[] }

/**
 * Cumulative pace integration along a sampled split-time series.
 *
 * Velocity (m/s) at sample i is `500 / split[i]`, where `split[i]` is the
 * boat's 500 m split time in seconds. Distance is integrated step-wise:
 * `d[i] = d[i-1] + v[i] * (tSec[i] - tSec[i-1])`. The first entry is always 0.
 *
 * Non-positive splits are treated as zero velocity (no distance accumulates
 * across that step). Returns an empty array for empty input. Output length
 * matches input length.
 */
export function reconstructDistance(s: Samples): number[] {
  const n = s.tSec.length
  if (n === 0) return []
  const out = new Array<number>(n)
  out[0] = 0
  for (let i = 1; i < n; i++) {
    const dt = s.tSec[i] - s.tSec[i - 1]
    const split = s.split[i]
    const v = split > 0 ? 500 / split : 0
    out[i] = out[i - 1] + v * dt
  }
  return out
}

/** Find the largest index `i` such that `xs[i] <= x`. Assumes `xs` sorted ascending and non-empty. */
function lowerBracket(xs: number[], x: number): number {
  let lo = 0
  let hi = xs.length - 1
  if (x <= xs[lo]) return lo
  if (x >= xs[hi]) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * Compute Fritsch–Carlson monotone slopes at each knot.
 *
 * Endpoint slopes use one-sided forward/backward differences. Interior knots
 * use the standard monotone-cubic recipe: if neighbouring secant slopes have
 * opposite signs (or either is zero), the knot slope is set to 0; otherwise
 * a weighted-harmonic combination is used. This guarantees the resulting
 * cubic Hermite spline is monotone.
 */
function monotoneSlopes(xs: number[], ys: number[]): number[] {
  const n = xs.length
  const m = new Array<number>(n)
  if (n === 0) return m
  if (n === 1) {
    m[0] = 0
    return m
  }
  const d = new Array<number>(n - 1) // secant slopes
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i]
    d[i] = h !== 0 ? (ys[i + 1] - ys[i]) / h : 0
  }
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) {
    const dl = d[i - 1]
    const dr = d[i]
    if (dl === 0 || dr === 0 || Math.sign(dl) !== Math.sign(dr)) {
      m[i] = 0
    } else {
      const hl = xs[i] - xs[i - 1]
      const hr = xs[i + 1] - xs[i]
      const w1 = 2 * hr + hl
      const w2 = hr + 2 * hl
      m[i] = (w1 + w2) / (w1 / dl + w2 / dr)
    }
  }
  return m
}

/** Evaluate a Hermite cubic on [x0,x1] with values y0,y1 and slopes m0,m1 at x. */
function hermite(x: number, x0: number, x1: number, y0: number, y1: number, m0: number, m1: number): number {
  const h = x1 - x0
  if (h === 0) return y0
  const t = (x - x0) / h
  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  return h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1
}

/**
 * Monotone-cubic (Fritsch–Carlson) interpolation of a distance series at time `t`.
 *
 * Returns 0 for an empty series. Below the first sample, clamps to the first
 * distance; above the last, clamps to the last. Between samples, returns the
 * monotone Hermite cubic value, which preserves the non-decreasing shape of
 * the input (distance series are monotone non-decreasing by construction).
 */
export function distanceAt(series: DistanceSeries, t: number): number {
  const { tSec, distM } = series
  const n = tSec.length
  if (n === 0) return 0
  if (n === 1) return distM[0]
  if (t <= tSec[0]) return distM[0]
  if (t >= tSec[n - 1]) return distM[n - 1]
  const i = lowerBracket(tSec, t)
  const slopes = monotoneSlopes(tSec, distM)
  return hermite(t, tSec[i], tSec[i + 1], distM[i], distM[i + 1], slopes[i], slopes[i + 1])
}

// Internal helpers exported for potential reuse in adjacent modules; kept
// non-public to the package surface by convention (not re-exported from index).
export const _internal = { monotoneSlopes, lowerBracket, hermite }
