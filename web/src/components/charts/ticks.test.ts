import { describe, it, expect } from 'vitest'
import { selectXTicksAtCalendarBoundaries, selectYTicksRound, selectTimeAxisTicks } from './ticks'

const T = (iso: string) => new Date(iso).getTime()

describe('selectXTicksAtCalendarBoundaries', () => {
  it('30-day span → Monday week starts, unique labels', () => {
    const ticks = selectXTicksAtCalendarBoundaries(T('2026-05-13T00:00:00'), T('2026-06-12T00:00:00'))
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks.length).toBeLessThanOrEqual(5)
    for (const tk of ticks) {
      const d = new Date(tk.t)
      expect(d.getDay()).toBe(1) // Monday
      expect(d.getHours()).toBe(0)
    }
    expect(new Set(ticks.map((x) => x.label)).size).toBe(ticks.length)
  })

  it('two-month span → no repeated month-only labels (Mai Mai Mai bug)', () => {
    const ticks = selectXTicksAtCalendarBoundaries(T('2026-04-15T00:00:00'), T('2026-06-12T00:00:00'))
    expect(new Set(ticks.map((x) => x.label)).size).toBe(ticks.length)
  })

  it('365-day span → month starts, year appended (Mai \'26)', () => {
    const ticks = selectXTicksAtCalendarBoundaries(T('2025-06-12T00:00:00'), T('2026-06-12T00:00:00'))
    for (const tk of ticks) expect(new Date(tk.t).getDate()).toBe(1)
    expect(ticks.some((x) => x.label.includes('’26'))).toBe(true)
    expect(new Set(ticks.map((x) => x.label)).size).toBe(ticks.length) // no 2026 2026 2026
  })

  it('multi-year span → year starts', () => {
    const ticks = selectXTicksAtCalendarBoundaries(T('2023-02-01T00:00:00'), T('2026-06-12T00:00:00'))
    for (const tk of ticks) {
      const d = new Date(tk.t)
      expect([d.getMonth(), d.getDate()]).toEqual([0, 1])
    }
    expect(ticks.map((x) => x.label)).toEqual(['2024', '2025', '2026'])
  })

  it('one-week span → day starts', () => {
    const ticks = selectXTicksAtCalendarBoundaries(T('2026-06-05T12:00:00'), T('2026-06-12T12:00:00'))
    for (const tk of ticks) expect(new Date(tk.t).getHours()).toBe(0)
  })
})

describe('selectYTicksRound', () => {
  it('split: 5 s steps covering the range', () => {
    expect(selectYTicksRound(112, 128, 'split')).toEqual([110, 115, 120, 125, 130])
  })
  it('split: wide range doubles the step instead of exceeding 6 ticks', () => {
    const ticks = selectYTicksRound(100, 175, 'split')
    expect(ticks.length).toBeLessThanOrEqual(6)
    expect(ticks[0] % 5).toBe(0)
  })
  it('watt: 10 W steps', () => {
    expect(selectYTicksRound(183, 219, 'watt')).toEqual([180, 190, 200, 210, 220])
  })
  it('spm: 1 steps', () => {
    expect(selectYTicksRound(18.2, 21.7, 'spm')).toEqual([18, 19, 20, 21, 22])
  })
  it('dps: 0.5 steps', () => {
    expect(selectYTicksRound(8.1, 9.4, 'dps')).toEqual([8, 8.5, 9, 9.5])
  })
})

describe('selectTimeAxisTicks', () => {
  it('20-min session → 5-min boundaries', () => {
    expect(selectTimeAxisTicks(0, 1200)).toEqual([0, 300, 600, 900, 1200])
  })
  it('90-s sprint → 30-s boundaries', () => {
    expect(selectTimeAxisTicks(0, 90)).toEqual([0, 30, 60, 90])
  })
})
