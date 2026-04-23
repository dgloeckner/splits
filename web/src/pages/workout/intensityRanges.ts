export type Range = { lo: number; hi: number | null }
export type IntensityRange = {
  splitSec: Range
  spm: Range
}

// Static v1 defaults. TODO: replace with per-user defaults once FEAT-0004 (PBs) lands.
export const intensityRanges: Record<string, IntensityRange> = {
  locker:  { splitSec: { lo: 140, hi: 160 }, spm: { lo: 18, hi: 22 } },
  moderat: { splitSec: { lo: 125, hi: 140 }, spm: { lo: 22, hi: 26 } },
  hart:    { splitSec: { lo: 110, hi: 125 }, spm: { lo: 26, hi: 30 } },
  allout:  { splitSec: { lo: 0,   hi: 110 }, spm: { lo: 30, hi: null } },
}

export function formatSplit(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatSplitRange(r: Range): string {
  if (r.lo === 0) return `< ${formatSplit(r.hi ?? 0)}`
  return `${formatSplit(r.lo)} – ${formatSplit(r.hi ?? 0)}`
}

export function formatSpmRange(r: Range): string {
  if (r.hi === null) return `${r.lo}+`
  return `${r.lo} – ${r.hi}`
}
