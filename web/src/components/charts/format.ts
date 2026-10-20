import { decimalComma, fmtFloat, fmtInt, pace500m } from '../../util/format'
import type { TrendsWindowKey } from '../../api/client'
import type { ChartMetric } from './ticks'

const SHORT_MONTH_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const LONG_MONTH_DE  = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const SHORT_DAY_DE   = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const LONG_DAY_DE    = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

export function formatChartDate(t: number, range: string): string {
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
    default:
      return String(d.getFullYear())
  }
}

export function formatStripDate(t: number): string {
  const d = new Date(t)
  return `${d.getDate()}. ${LONG_MONTH_DE[d.getMonth()]} · ${LONG_DAY_DE[d.getDay()]}`
}

/**
 * The resolved range of a rolling window, shown under the window tabs
 * so "Monat" does not read as a calendar month (#48):
 * "20. Sep – 20. Okt 2026", the start year only when it differs.
 * For "all", fromMs is the oldest point (null when there are none).
 */
export function formatRangeCaption(fromMs: number | null, toMs: number, window: TrendsWindowKey): string {
  if (window === 'all') {
    if (fromMs === null) return 'Alle Sessions'
    const f = new Date(fromMs)
    return `seit ${f.getDate()}. ${SHORT_MONTH_DE[f.getMonth()]} ${f.getFullYear()}`
  }
  const f = new Date(fromMs ?? toMs)
  const t = new Date(toMs)
  const day = (d: Date) => `${d.getDate()}. ${SHORT_MONTH_DE[d.getMonth()]}`
  const start = f.getFullYear() === t.getFullYear() ? day(f) : `${day(f)} ${f.getFullYear()}`
  return `${start} – ${day(t)} ${t.getFullYear()}`
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

/**
 * One formatter per session metric, shared by the session hero panel
 * and the chart Ø labels so the same average reads the same on the
 * same screen (#45): split m:ss,t, watt whole watts, SPM one decimal,
 * DPS two decimals — all with the decimal comma (FEAT-0008 §Copy, #40).
 */
export const formatMetric: Record<ChartMetric, (v: number | null | undefined) => string> = {
  split: (v) => decimalComma(pace500m(v)),
  watt: (v) => fmtInt(v == null ? v : Math.round(v)),
  spm: (v) => decimalComma(fmtFloat(v, 1)),
  dps: (v) => decimalComma(fmtFloat(v, 2)),
}

/** Y-axis tick labels per metric: as formatMetric, DPS at one decimal (ticks sit on 0.5 m steps). */
export const formatTick: Record<ChartMetric, (v: number) => string> = {
  split: (v) => formatMetric.split(v),
  watt: (v) => formatMetric.watt(v),
  spm: (v) => fmtInt(Math.round(v)),
  dps: (v) => decimalComma(fmtFloat(v, 1)),
}
