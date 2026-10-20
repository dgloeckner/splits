import type { TrendsWindowKey } from '../../api/client'

/**
 * The narrowest wider window that holds the latest session, for a first
 * visit whose Monat is empty (#50). Measured back from the window end the
 * backend reports, by calendar days like its AddDate, not from Date.now().
 */
export function pickWindowFor(latestMs: number, windowToMs: number): TrendsWindowKey {
  const yearStart = new Date(windowToMs)
  yearStart.setDate(yearStart.getDate() - 365)
  return latestMs >= yearStart.getTime() ? '365d' : 'all'
}
