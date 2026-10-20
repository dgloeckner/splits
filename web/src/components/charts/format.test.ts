import { describe, it, expect } from 'vitest'
import { formatChartDate, formatStripDate, formatRollingDelta, formatMetric, formatRangeCaption, formatMonthHeading, formatMonthChip } from './format'

// All dates in Berlin local for stability (the app already assumes Berlin TZ).
const MAY_17_2026 = new Date('2026-05-17T10:00:00+02:00').getTime() // Sunday
const JAN_3_2025 = new Date('2025-01-03T10:00:00+01:00').getTime()  // Friday

describe('formatChartDate', () => {
  it('returns weekday short for "week" range', () => {
    expect(formatChartDate(MAY_17_2026, 'week')).toBe('So')
    expect(formatChartDate(JAN_3_2025, 'week')).toBe('Fr')
  })

  it('returns day + short month for "month" range', () => {
    expect(formatChartDate(MAY_17_2026, 'month')).toBe('17. Mai')
    expect(formatChartDate(JAN_3_2025, 'month')).toBe('3. Jan')
  })

  it('returns short month only for "year" range', () => {
    expect(formatChartDate(MAY_17_2026, 'year')).toBe('Mai')
    expect(formatChartDate(JAN_3_2025, 'year')).toBe('Jan')
  })

  it('returns 4-digit year for "all" range', () => {
    expect(formatChartDate(MAY_17_2026, 'all')).toBe('2026')
    expect(formatChartDate(JAN_3_2025, 'all')).toBe('2025')
  })
})

describe('formatStripDate', () => {
  it('returns "D. Month · Weekday" in German', () => {
    expect(formatStripDate(MAY_17_2026)).toBe('17. Mai · Sonntag')
    expect(formatStripDate(JAN_3_2025)).toBe('3. Januar · Freitag')
  })
})

describe('formatRangeCaption', () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00`).getTime()

  it('omits the start year when both dates share a year', () => {
    expect(formatRangeCaption(at('2026-09-20'), at('2026-10-20'), '30d')).toBe('20. Sep – 20. Okt 2026')
  })

  it('names both years across a year boundary', () => {
    expect(formatRangeCaption(at('2025-10-20'), at('2026-10-20'), '365d')).toBe('20. Okt 2025 – 20. Okt 2026')
    expect(formatRangeCaption(at('2025-12-21'), at('2026-01-20'), '30d')).toBe('21. Dez 2025 – 20. Jan 2026')
  })

  it('"all" starts at the oldest point, or names no range without points', () => {
    expect(formatRangeCaption(at('2025-05-03'), at('2026-10-20'), 'all')).toBe('seit 3. Mai 2025')
    expect(formatRangeCaption(null, at('2026-10-20'), 'all')).toBe('Alle Sessions')
  })
})

describe('formatMonthHeading / formatMonthChip', () => {
  it('long month and year; short month and two-digit year', () => {
    expect(formatMonthHeading(MAY_17_2026)).toBe('Mai 2026')
    expect(formatMonthChip(JAN_3_2025)).toBe('Jan ’25')
  })
})

describe('formatRollingDelta', () => {
  const fmt = (v: number) => v.toFixed(1)

  it('returns "—" when rollingAvg is null', () => {
    expect(formatRollingDelta(10, null, 14, fmt)).toBe('—')
  })

  it('returns "—" when windowDays is null', () => {
    expect(formatRollingDelta(10, 9, null, fmt)).toBe('—')
  })

  it('arrow up when current > avg', () => {
    // current 9.7, avg 9.6 → +0.1 → "↑0.1 vs 14-d Ø"
    expect(formatRollingDelta(9.7, 9.6, 14, fmt)).toBe('↑0.1 vs 14-d Ø')
  })

  it('arrow down when current < avg', () => {
    expect(formatRollingDelta(9.5, 9.6, 14, fmt)).toBe('↓0.1 vs 14-d Ø')
  })

  it('arrow direction is mechanical, not improvement-based (invert flag is for caller tone)', () => {
    // The invert flag is accepted (used by callers to color the chip) but
    // does NOT change the arrow. Arrow always follows the raw delta sign.
    expect(formatRollingDelta(107, 108, 14, fmt, true)).toBe('↓1.0 vs 14-d Ø')
    expect(formatRollingDelta(109, 108, 14, fmt, true)).toBe('↑1.0 vs 14-d Ø')
  })

  it('returns "—" when delta is exactly zero', () => {
    expect(formatRollingDelta(10, 10, 14, fmt)).toBe('—')
  })
})

describe('formatMetric', () => {
  it('split as m:ss.t', () => {
    expect(formatMetric.split(108)).toBe('1:48,0')
    expect(formatMetric.split(107.84)).toBe('1:47,8')
  })
  it('watt as whole watts, rounded', () => {
    expect(formatMetric.watt(378)).toBe('378')
    expect(formatMetric.watt(377.6)).toBe('378')
  })
  it('SPM with one decimal', () => {
    expect(formatMetric.spm(28.6)).toBe('28,6')
    expect(formatMetric.spm(29)).toBe('29,0')
  })
  it('DPS with two decimals', () => {
    expect(formatMetric.dps(9.55)).toBe('9,55')
    expect(formatMetric.dps(9.6)).toBe('9,60')
  })
  it('missing values render a dash', () => {
    for (const f of Object.values(formatMetric)) {
      expect(f(null)).toBe('—')
      expect(f(undefined)).toBe('—')
    }
  })
})
