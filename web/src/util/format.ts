const DASH = '—'

export function mmss(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH
  const s = Math.max(0, seconds)
  const mins = Math.floor(s / 60)
  const secs = s - mins * 60
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`
}

// Whole-second mm:ss — for session time and similar long-running clocks where
// tenths are visual noise. Keep mmss() for split/pace where tenths matter.
export function mmssWhole(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH
  const s = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(s / 60)
  const secs = s - mins * 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function pace500m(paceSecondsPer500m: number | null | undefined): string {
  if (paceSecondsPer500m === null || paceSecondsPer500m === undefined) return DASH
  if (!Number.isFinite(paceSecondsPer500m) || paceSecondsPer500m <= 0) return DASH
  return mmss(paceSecondsPer500m)
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return String(Math.trunc(v))
}

export function fmtFloat(v: number | null | undefined, decimals: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const factor = 10 ** decimals
  return (Math.round(v * factor) / factor).toFixed(decimals)
}

export function fmtMeters(meters: number | null | undefined): string {
  return fmtInt(meters)
}

/**
 * Canonical short label for a workout distance, used by Step2 chip
 * row, ConfirmScreen title, and anywhere else we display a preset or
 * custom distance to the user.
 *
 *   500   → "500 m"
 *   1000  → "1 km"
 *   3500  → "3.5 km"   (Eigene custom values)
 *   5000  → "5 km"
 *
 * Unifies the previously-divergent Step2 and ConfirmScreen formatters
 * (F3). HM / Marathon special-cases removed in F11 — household rowers
 * don't use those distances.
 */
export function formatDistanceLabel(meters: number): string {
  if (meters >= 1000) {
    // JS number→string already drops trailing zeroes (1000/1000 → "1",
    // 3500/1000 → "3.5"), so no fixed-precision call needed.
    return `${meters / 1000} km`
  }
  return `${meters} m`
}

// hhmm renders a duration in seconds as h:mm — e.g. 5_400 → "1:30".
// For sub-hour durations it falls back to "0:MM".
export function hhmm(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s - h * 3600) / 60)
  return `${h}:${m.toString().padStart(2, '0')}`
}

// signedPct renders a percentage delta with a leading sign — e.g. 0.123 → "+12 %".
// The argument is a fraction, not a percentage. NaN / Infinity → DASH.
export function signedPct(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return DASH
  const pct = Math.round(fraction * 100)
  if (pct === 0) return '0 %'
  return `${pct > 0 ? '+' : ''}${pct} %`
}

// signedNum renders a numeric delta with a leading sign and configurable
// decimal precision — e.g. 0.42 → "+0.4". 0 stays unsigned ("0.0").
export function signedNum(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const factor = 10 ** decimals
  const rounded = Math.round(v * factor) / factor
  if (rounded === 0) return rounded.toFixed(decimals)
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(decimals)}`
}
