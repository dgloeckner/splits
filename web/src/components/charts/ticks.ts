// Pure tick selection for the chart family (spec §Chart rules).
// X ticks sit on calendar boundaries chosen from the actual data span —
// never derived from a range *name* — which makes the
// "2026 2026 2026 / Mai Mai Mai / weekday labels on 8 weeks" bug class
// structurally impossible.

export type ChartMetric = 'split' | 'watt' | 'spm' | 'dps'
export type XTick = { t: number; label: string }

const DAY_MS = 86_400_000
const SHORT_MONTH_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

function startOfDay(t: number): Date {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d
}

export function selectXTicksAtCalendarBoundaries(fromMs: number, toMs: number): XTick[] {
  if (!(toMs > fromMs)) return []
  const spanDays = (toMs - fromMs) / DAY_MS
  const unit: 'day' | 'week' | 'month' | 'year' =
    spanDays <= 14 ? 'day' : spanDays <= 100 ? 'week' : spanDays <= 750 ? 'month' : 'year'

  const boundaries: Date[] = []
  const d = startOfDay(fromMs)
  if (unit === 'day') {
    if (d.getTime() < fromMs) d.setDate(d.getDate() + 1)
    while (d.getTime() <= toMs) {
      boundaries.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
  } else if (unit === 'week') {
    while (d.getDay() !== 1 || d.getTime() < fromMs) d.setDate(d.getDate() + 1)
    while (d.getTime() <= toMs) {
      boundaries.push(new Date(d))
      d.setDate(d.getDate() + 7)
    }
  } else if (unit === 'month') {
    d.setDate(1)
    if (d.getTime() < fromMs) d.setMonth(d.getMonth() + 1)
    while (d.getTime() <= toMs) {
      boundaries.push(new Date(d))
      d.setMonth(d.getMonth() + 1)
    }
  } else {
    d.setMonth(0, 1)
    if (d.getTime() < fromMs) d.setFullYear(d.getFullYear() + 1)
    while (d.getTime() <= toMs) {
      boundaries.push(new Date(d))
      d.setFullYear(d.getFullYear() + 1)
    }
  }

  // Cap at 5 ticks by striding; keep the first boundary anchored.
  const stride = Math.max(1, Math.ceil(boundaries.length / 5))
  const picked = boundaries.filter((_, i) => i % stride === 0)

  const crossesYear = new Date(fromMs).getFullYear() !== new Date(toMs).getFullYear()
  return picked.map((b) => ({ t: b.getTime(), label: tickLabel(b, unit, crossesYear) }))
}

function tickLabel(d: Date, unit: 'day' | 'week' | 'month' | 'year', crossesYear: boolean): string {
  switch (unit) {
    case 'day':
    case 'week':
      return `${d.getDate()}.${d.getMonth() + 1}.`
    case 'month': {
      const m = SHORT_MONTH_DE[d.getMonth()]
      // Coarser unit appended when the span crosses it: "Mai '26".
      return crossesYear ? `${m} ’${String(d.getFullYear()).slice(2)}` : m
    }
    case 'year':
      return String(d.getFullYear())
  }
}

const Y_STEP: Record<ChartMetric, number> = { split: 5, watt: 10, spm: 1, dps: 0.5 }

// Round y-ticks per metric (split 5 s, watt 10 W, SPM 1, DPS 0.5 m),
// never data-span ± 5 %. Step doubles until ≤ 6 ticks cover the range.
export function selectYTicksRound(min: number, max: number, metric: ChartMetric): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (max < min) [min, max] = [max, min]
  let step = Y_STEP[metric]
  while (Math.ceil(max / step) - Math.floor(min / step) > 5) step *= 2
  const out: number[] = []
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + 1e-9; v += step) {
    out.push(Math.round(v * 100) / 100)
  }
  return out
}

const TIME_STEPS_SEC = [10, 30, 60, 120, 300, 600, 900, 1800, 3600]

// Time-axis ticks for session-detail charts: round time boundaries,
// ≤ 6 ticks.
export function selectTimeAxisTicks(minSec: number, maxSec: number): number[] {
  if (!(maxSec > minSec)) return []
  const span = maxSec - minSec
  const step = TIME_STEPS_SEC.find((s) => span / s <= 5) ?? TIME_STEPS_SEC[TIME_STEPS_SEC.length - 1]
  const out: number[] = []
  for (let v = Math.floor(minSec / step) * step; v <= maxSec + 1e-9; v += step) {
    if (v >= minSec) out.push(v)
  }
  return out
}
