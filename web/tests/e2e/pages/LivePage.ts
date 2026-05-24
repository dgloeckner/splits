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
   * Wait until the hero is past its warmup-period transients:
   *
   * 1. Distance ≥ minDistanceM — guarantees several strokes have been
   *    processed (the device emits an unstable opening split until it
   *    has enough data to compute one; e.g. session-short frame 1
   *    ships "10:45 /500m").
   * 2. All five hero metrics render a numeric (not "—") value — this
   *    is the gate the regression catches: a missing wire field shows
   *    up as a perpetual em-dash even though the rest of the row is
   *    fine.
   */
  async waitForHeroSettled(minDistanceM = 50, timeoutMs = 30_000) {
    await expect
      .poll(
        async () => {
          const txt = (
            await this.page.getByTestId('hero-distanz-value').textContent()
          )?.trim()
          const n = Number(txt)
          return Number.isFinite(n) ? n : 0
        },
        { timeout: timeoutMs, message: 'distance never crossed warmup gate' },
      )
      .toBeGreaterThanOrEqual(minDistanceM)

    // After distance has crossed the gate, every hero metric must
    // hold a numeric value — em-dash is a regression.
    for (const testId of [
      'hero-split',
      'hero-zeit-value',
      'hero-distanz-value',
      'hero-spm-value',
      'hero-watt-value',
    ] as const) {
      const txt = (await this.page.getByTestId(testId).textContent())?.trim() ?? ''
      expect(txt, `${testId} text "${txt}" should not be em-dash`).not.toBe('—')
    }
  }

  /**
   * Assert all five hero metrics are within fixture-derived bounds.
   * Bounds bake in EMA latency, hysteresis, count-up tween, and
   * dead-reckoning extrapolation past the last frame.
   *
   * Split bounds use a *wide* range (60 s on each side of the fixture
   * average pace) because the wire field is the rower's own
   * stroke-by-stroke split-pace, which moves more than the
   * session-mean derivation does — especially during the warmup
   * ramp and any short pause.
   */
  async expectHeroMatchesFixture(fx: FixtureStats) {
    const splitText = (await this.page.getByTestId('hero-split').textContent())!.trim()
    expect(splitText).toMatch(/^\d+:\d{2}\.\d$/)
    const splitSec = paceToSeconds(splitText)
    expect(splitSec).toBeGreaterThan(60) // sub-1:00 splits would mean we picked up a stale "0:00" or worse
    expect(splitSec).toBeLessThan(360) // 6:00 ceiling — anything slower is the device's pre-warmup sentinel

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
