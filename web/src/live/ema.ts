/**
 * Pure helpers for exponential moving average + hysteresis.
 *
 * Both functions are side-effect free and suitable for use inside
 * reducers and display hooks alike.
 */

/**
 * Single-step exponential moving average.
 *
 * @param prev previous smoothed value, or null when no history yet.
 * @param next newly-observed raw value.
 * @param alpha smoothing factor in (0, 1]; higher = more responsive.
 * @returns `next` when `prev` is null (seed), otherwise `alpha * next + (1-alpha) * prev`.
 */
export function ema(prev: number | null, next: number, alpha: number): number {
  if (prev === null) return next
  return alpha * next + (1 - alpha) * prev
}

/**
 * Display-level hysteresis: keep the previously-displayed value while
 * the candidate only wiggles by less than `threshold`. This avoids
 * flicker on rounded integer/fixed-decimal displays.
 */
export function applyHysteresis(
  current: number,
  candidate: number,
  threshold: number,
): number {
  if (Math.abs(candidate - current) < threshold) return current
  return candidate
}
