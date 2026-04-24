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
