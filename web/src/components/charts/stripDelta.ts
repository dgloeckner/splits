import type { ChartMetric } from './ticks'

// Strip delta in rower language: "−1,3 s vs Ø 14 Tage", never
// "↓0:01.3 vs 14-d Ø". Sign and color agree — callers derive tone
// from the *improvement* direction; this string only ever carries the
// raw signed delta (spec §Chart rules: no ↓ −98 % double-encoding).
export function formatStripDelta(
  current: number,
  rollingAvg: number | null,
  windowDays: number,
  metric: ChartMetric,
): string {
  if (rollingAvg === null) return '—'
  const delta = current - rollingAvg
  if (delta === 0) return '—'
  const sign = delta > 0 ? '+' : '−'
  const abs = Math.abs(delta)
  const num = (v: number, dec: number) => v.toFixed(dec).replace('.', ',')
  const value =
    metric === 'split' ? `${num(abs, 1)} s`
    : metric === 'watt' ? `${Math.round(abs)} W`
    : metric === 'spm' ? `${num(abs, 1)} SPM`
    : `${num(abs, 1)} m`
  return `${sign}${value} vs Ø ${windowDays} T`
}

// Improvement test for tone: split improves downward.
export function isImprovement(current: number, rollingAvg: number, metric: ChartMetric): boolean {
  return metric === 'split' ? current < rollingAvg : current > rollingAvg
}
