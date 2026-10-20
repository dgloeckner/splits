import { expect, type Page } from '@playwright/test'
import { paceToSeconds, type FixtureStats } from '../helpers/fixtureStats'

/**
 * /historie with three sub-tabs (Sessions / Trends / Rekorde).
 */
export class HistoryPage {
  constructor(private readonly page: Page) {}

  async openSessions() {
    await this.page.goto('/historie')
  }
  async openRekorde() {
    await this.page.goto('/historie/rekorde')
  }
  async openTrends() {
    await this.page.goto('/historie/trends')
  }

  /** True when the Rekorde tab has at least one PB row. */
  async expectAtLeastOnePB() {
    await expect(this.page.getByText(/Noch keine Bestleistungen/i)).toHaveCount(0, {
      timeout: 10_000,
    })
  }

  /** True when the Sessions tab shows at least one row with a distance value. */
  async expectAtLeastOneSession() {
    await expect(this.page.locator('text=/\\d+ m/').first()).toBeVisible({
      timeout: 10_000,
    })
  }

  /**
   * Click into the first session row and wait for its detail page to
   * render the chart strip (the latest indicator that summary +
   * samples + PB banners have all loaded).
   */
  async openFirstSession() {
    // Session cards are <a href="/historie/{ulid}">; the BottomNav also
    // emits /historie/trends and /historie/rekorde, so filter to links
    // that contain a distance pill (the only links with "<n> m" text).
    const firstRow = this.page
      .locator('a[href^="/historie/"]')
      .filter({ hasText: /\d+\s*m/ })
      .first()
    await expect(firstRow).toBeVisible({ timeout: 15_000 })
    await firstRow.click()
    await expect(this.page.getByText(/Split-Verlauf/)).toBeVisible({ timeout: 10_000 })
    await expect(this.page.getByText(/Watt-Verlauf/)).toBeVisible()
    await expect(this.page.getByText(/SPM-Verlauf/)).toBeVisible()
  }

  /** Sessions tab — first row's distance must be near the fixture's. */
  async expectFirstSessionDistanceNear(fx: FixtureStats, tolerance = 15) {
    const firstRow = this.page
      .locator('a[href^="/historie/"]')
      .filter({ hasText: /\d+\s*m/ })
      .first()
    await expect(firstRow).toBeVisible({ timeout: 15_000 })
    const text = (await firstRow.locator('text=/\\d+\\s*m/').first().textContent())!.trim()
    const m = text.match(/(\d+)/)
    const value = m ? Number(m[1]) : NaN
    expect(value).toBeGreaterThanOrEqual(fx.distanceCoveredM - tolerance)
    expect(value).toBeLessThanOrEqual(fx.distanceCoveredM + tolerance)
  }

  /**
   * Detail page — assert hero numerics + chart paths against the
   * fixture-derived expectations. Bounds are tight: backend totals
   * come straight from the last frame's distance, and the per-stroke
   * series determines all averages.
   */
  async expectDetailMatchesFixture(fx: FixtureStats) {
    const paths = this.page.locator('svg path[d]')
    expect(await paths.count()).toBeGreaterThanOrEqual(3)

    const distText = (
      await this.page.getByTestId('detail-total-distance').textContent()
    )!.trim()
    const distM = Number((distText.match(/(\d+)/) ?? ['0', '0'])[1])
    expect(distM).toBeGreaterThanOrEqual(fx.distanceCoveredM - 15)
    expect(distM).toBeLessThanOrEqual(fx.distanceCoveredM + 15)

    const totalTimeText = (
      await this.page.getByTestId('detail-total-time').textContent()
    )!.trim()
    const totalTimeSec = paceToSeconds(totalTimeText)
    expect(Number.isFinite(totalTimeSec)).toBe(true)
    expect(totalTimeSec).toBeGreaterThanOrEqual(fx.durationSec - 5)
    expect(totalTimeSec).toBeLessThanOrEqual(fx.finalTimeSec + 5)

    const strokesText = (
      await this.page.getByTestId('detail-total-strokes').textContent()
    )!.trim()
    const strokes = Number(strokesText)
    expect(strokes).toBeGreaterThanOrEqual(fx.strokeCount - 3)
    expect(strokes).toBeLessThanOrEqual(fx.strokeCount + 1)

    const avgSplitText = (
      await this.page.getByTestId('detail-avg-split').textContent()
    )!.trim()
    const avgSplitSec = paceToSeconds(avgSplitText)
    expect(Number.isFinite(avgSplitSec)).toBe(true)
    expect(avgSplitSec).toBeGreaterThan(fx.avgPaceSecPer500m - 30)
    expect(avgSplitSec).toBeLessThan(fx.avgPaceSecPer500m + 30)

    const avgSpm = Number(
      (await this.page.getByTestId('detail-avg-spm').textContent())!.trim().replace(',', '.'),
    )
    expect(Number.isFinite(avgSpm)).toBe(true)
    expect(avgSpm).toBeGreaterThan(fx.avgSPM - 5)
    expect(avgSpm).toBeLessThan(fx.avgSPM + 5)

    const avgWatt = Number(
      (await this.page.getByTestId('detail-avg-watt').textContent())!.trim(),
    )
    expect(Number.isFinite(avgWatt)).toBe(true)
    expect(avgWatt).toBeGreaterThan(fx.avgPowerW - 40)
    expect(avgWatt).toBeLessThan(fx.avgPowerW + 40)
  }
}
