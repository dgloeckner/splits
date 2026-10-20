import { describe, it, expect } from 'vitest'
import type { TrendsPoint } from '../../api/client'
import { groupByMonth, monthGroupHeading } from './groupByMonth'

// Local midday, so the month never depends on the test runner's zone.
function pt(day: string, distance_m: number, id = day): TrendsPoint {
  return {
    t: new Date(`${day}T12:00:00`).toISOString(), session_id: id, mode: 'distance',
    distance_m, time_sec: 600, avg_pace_sec_per_500m: 120, avg_power_w: 200,
    avg_spm: 22, avg_dps: 9, completed: true, distance_pb: false,
  }
}

describe('groupByMonth', () => {
  it('groups newest month first, newest session first inside a month', () => {
    const groups = groupByMonth([
      pt('2026-05-03', 2000), pt('2026-06-20', 5000), pt('2026-05-28', 2000), pt('2026-06-02', 5000),
    ])
    expect(groups.map((g) => g.key)).toEqual(['2026-06', '2026-05'])
    expect(groups[0].points.map((q) => q.session_id)).toEqual(['2026-06-20', '2026-06-02'])
    expect(groups[1].points.map((q) => q.session_id)).toEqual(['2026-05-28', '2026-05-03'])
  })

  it('splits December and January into their own years', () => {
    const groups = groupByMonth([pt('2025-12-31', 1000), pt('2026-01-01', 1000)])
    expect(groups.map((g) => g.key)).toEqual(['2026-01', '2025-12'])
    expect(monthGroupHeading(groups[0])).toBe('Januar 2026 · 1 Session · 1 km')
    expect(monthGroupHeading(groups[1])).toBe('Dezember 2025 · 1 Session · 1 km')
  })

  it('heading sums km to one decimal and pluralises', () => {
    const [g] = groupByMonth([pt('2026-06-01', 5000), pt('2026-06-02', 6620), pt('2026-06-03', 6580)])
    expect(monthGroupHeading(g)).toBe('Juni 2026 · 3 Sessions · 18,2 km')
  })

  it('no points, no groups', () => {
    expect(groupByMonth([])).toEqual([])
  })
})
