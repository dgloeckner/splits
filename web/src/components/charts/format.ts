import type { TrendsRange } from '../../api/client'

const SHORT_MONTH_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const LONG_MONTH_DE  = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const SHORT_DAY_DE   = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const LONG_DAY_DE    = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

export function formatChartDate(t: number, range: TrendsRange): string {
  const d = new Date(t)
  switch (range) {
    case 'week':
      return SHORT_DAY_DE[d.getDay()]
    case 'month':
      return `${d.getDate()}. ${SHORT_MONTH_DE[d.getMonth()]}`
    case 'year':
      return SHORT_MONTH_DE[d.getMonth()]
    case 'all':
      return String(d.getFullYear())
  }
}

export function formatStripDate(t: number): string {
  const d = new Date(t)
  return `${d.getDate()}. ${LONG_MONTH_DE[d.getMonth()]} · ${LONG_DAY_DE[d.getDay()]}`
}

/**
 * Format the "vs N-d Ø" chip text. The arrow direction follows the raw
 * delta sign (↑ if current > avg, ↓ if current < avg, regardless of
 * whether that's an improvement). The `invert` parameter is unused
 * inside this function — callers use it to decide chip *color* (tone),
 * which is a different concern.
 */
export function formatRollingDelta(
  current: number,
  rollingAvg: number | null,
  windowDays: number | null,
  fmt: (v: number) => string,
  _invert = false,
): string {
  if (rollingAvg === null || windowDays === null) return '—'
  const delta = current - rollingAvg
  if (delta === 0) return '—'
  const arrow = delta > 0 ? '↑' : '↓'
  return `${arrow}${fmt(Math.abs(delta))} vs ${windowDays}-d Ø`
}
