import { expect, type Page } from '@playwright/test'
import { mmssToSeconds, paceToSeconds, type FixtureStats } from '../helpers/fixtureStats'

/**
 * /live — hero shows split / time / distance / SPM / watt; tile grid
 * sits to the right. The page object exposes one method per metric so
 * spec files stay declarative ("split is in fixture range") instead of
 * leaking testids and number parsing.
 */
export class LivePage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto('/live')
  }

  /** Wait until the hero split has rendered a real m:ss.d value. */
  async waitForLiveSplit(timeoutMs = 15_000) {
    await expect(this.page.getByTestId('hero-split')).toHaveText(
      /^\d+:\d{2}\.\d$/,
      { timeout: timeoutMs },
    )
  }

  /**
   * Assert all five hero metrics are within fixture-derived bounds.
   * Bounds bake in EMA latency, hysteresis, count-up tween, and
   * dead-reckoning extrapolation past the last frame.
   */
  async expectHeroMatchesFixture(fx: FixtureStats) {
    const splitText = (await this.page.getByTestId('hero-split').textContent())!.trim()
    expect(splitText).toMatch(/^\d+:\d{2}\.\d$/)
    const splitSec = paceToSeconds(splitText)
    expect(splitSec).toBeGreaterThan(fx.avgPaceSecPer500m - 60)
    expect(splitSec).toBeLessThan(fx.avgPaceSecPer500m + 60)

    const distText = (await this.page.getByTestId('hero-distanz-value').textContent())!.trim()
    const dist = Number(distText)
    expect(Number.isFinite(dist)).toBe(true)
    expect(dist).toBeGreaterThan(0)
    expect(dist).toBeLessThan(fx.finalDistanceM + 200)

    const timeText = (await this.page.getByTestId('hero-zeit-value').textContent())!.trim()
    const tSec = mmssToSeconds(timeText)
    expect(Number.isFinite(tSec)).toBe(true)
    expect(tSec).toBeGreaterThan(0)
    expect(tSec).toBeLessThan(fx.finalTimeSec + 30)

    const spmText = (await this.page.getByTestId('hero-spm-value').textContent())!.trim()
    const spm = Number(spmText)
    expect(Number.isFinite(spm)).toBe(true)
    expect(spm).toBeGreaterThan(fx.avgSPM - 8)
    expect(spm).toBeLessThan(fx.avgSPM + 8)

    const wattText = (await this.page.getByTestId('hero-watt-value').textContent())!.trim()
    const watt = Number(wattText)
    expect(Number.isFinite(watt)).toBe(true)
    expect(watt).toBeGreaterThan(fx.avgPowerW - 70)
    expect(watt).toBeLessThan(fx.avgPowerW + 100)
  }
}
