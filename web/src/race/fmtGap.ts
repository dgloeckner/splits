/**
 * Shared signed-gap formatter for the race surface.
 *
 * Used by both `StatBar` (running display) and `FinishOverlay`
 * (post-horn frozen card) so the two render byte-identical text for the
 * same numeric gap. Previously each component carried its own local
 * `fmtGap` — StatBar emitted `+19.0s` (no space), FinishOverlay emitted
 * `+19.0 s` (with space) — and the cross-component-consistency
 * assertions had to whitespace-normalise the DOM to compare them. That
 * was a code smell pointing at this duplication; consolidating here
 * removes the need for the workaround (0019-02).
 *
 * Format: `<sign><abs.toFixed(1)> s` where `<sign>` is `+` for positive,
 * `-` for negative, and empty for exact-zero. The space before `s` is
 * intentional — readability beats compactness, and the live HUD has
 * room for it.
 */
export function fmtGap(n: number): string {
  if (n === 0) return '0.0 s'
  const sign = n > 0 ? '+' : '-'
  return `${sign}${Math.abs(n).toFixed(1)} s`
}
