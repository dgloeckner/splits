import type { TrendsRange } from '../../api/client'

const DAY = 24 * 60 * 60 * 1000

export function rangeRollingWindowDays(range: TrendsRange): number | null {
  switch (range) {
    case 'week':
      return null
    case 'month':
      return 14
    case 'year':
      return 30
    case 'all':
      return 90
  }
}

export function rollingAverage(
  points: { t: number; y: number }[],
  windowDays: number,
): { t: number; y: number }[] {
  if (points.length === 0) return []
  const windowMs = windowDays * DAY
  return points.map((p) => {
    let sum = 0
    let n = 0
    for (const q of points) {
      if (q.t > p.t) break
      if (q.t < p.t - windowMs) continue
      sum += q.y
      n++
    }
    return { t: p.t, y: n > 0 ? sum / n : p.y }
  })
}
