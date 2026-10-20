import type { TrendsPoint } from '../../api/client'
import { formatMonthHeading } from '../../components/charts/format'

export type MonthGroup = {
  /** Local `YYYY-MM` of the sessions' start, the header's id suffix. */
  key: string
  /** Start of the newest session in the group (ms), for labels. */
  t: number
  points: TrendsPoint[]
  distanceM: number
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Groups points by the local calendar month of `t`, newest month first
 * and newest session first inside each month (#49). Local time is the
 * Berlin display zone the list rows already use.
 */
export function groupByMonth(points: TrendsPoint[]): MonthGroup[] {
  const sorted = [...points].sort((a, b) => (a.t < b.t ? 1 : -1))
  const groups: MonthGroup[] = []
  for (const q of sorted) {
    const d = new Date(q.t)
    const key = monthKey(d)
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) {
      g = { key, t: d.getTime(), points: [], distanceM: 0 }
      groups.push(g)
    }
    g.points.push(q)
    g.distanceM += q.distance_m
  }
  return groups
}

/** "Juni 2026 · 6 Sessions · 18,2 km". */
export function monthGroupHeading(g: MonthGroup): string {
  const n = g.points.length
  const km = (g.distanceM / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })
  return `${formatMonthHeading(g.t)} · ${n} ${n === 1 ? 'Session' : 'Sessions'} · ${km} km`
}
