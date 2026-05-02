import { expect, type Page } from '@playwright/test'

export type Intensity = 'Locker' | 'Moderat' | 'Hart' | 'All-out'

/**
 * Three-step workout wizard: dimension (distance/time/intervals) →
 * intensity → confirm. Each method advances exactly one step.
 */
export class WorkoutFlow {
  constructor(private readonly page: Page) {}

  // ── Step 2 — distance ─────────────────────────────────────────────
  async expectDistanceStep() {
    await expect(this.page.getByText(/Distanz wählen/)).toBeVisible()
  }
  async pickDistancePreset(label: string) {
    await this.page.getByRole('button', { name: label }).first().click()
  }

  // ── Step 2 — time ─────────────────────────────────────────────────
  async expectTimeStep() {
    await expect(this.page.getByText(/Zeit wählen/)).toBeVisible()
  }
  async pickTimePreset(label: string) {
    await this.page.getByRole('button', { name: label }).first().click()
  }

  // ── Step 2 — intervals ────────────────────────────────────────────
  async pickIntervalsPreset(labelRegex: RegExp) {
    await this.page.getByRole('button', { name: labelRegex }).first().click()
  }

  /**
   * Drive the "Eigene" custom-interval form. Defaults: reps=4,
   * length=500 m, rest=120 s. The deltas are clicked relative to
   * those defaults; pass non-default values directly and the helper
   * decrements/increments to match.
   */
  async customIntervals(opts: { reps: number; lengthM: number; restSec: number }) {
    await this.page.getByRole('button', { name: 'Eigene' }).click()
    await expect(this.page.getByTestId('intervals-custom')).toBeVisible()
    await this.stepFromTo(
      this.page.getByTestId('intervals-reps'),
      4,
      opts.reps,
      1,
    )
    await this.stepFromTo(
      this.page.getByTestId('intervals-length'),
      500,
      opts.lengthM,
      100,
    )
    await this.stepFromTo(
      this.page.getByTestId('intervals-rest'),
      120,
      opts.restSec,
      30,
    )
    await this.page.getByRole('button', { name: 'Übernehmen' }).click()
  }

  // ── Step 3 — intensity ────────────────────────────────────────────
  async pickIntensity(level: Intensity) {
    await this.page.getByRole('button', { name: new RegExp(level, 'i') }).click()
  }

  // ── Confirm ───────────────────────────────────────────────────────
  async expectConfirmReady() {
    await expect(this.page.getByRole('button', { name: /^Start$/ })).toBeVisible()
  }
  async disableWarmup() {
    await this.page.getByRole('checkbox', { name: 'Warm-up' }).uncheck()
  }
  async disableCooldown() {
    await this.page.getByRole('checkbox', { name: 'Cool-down' }).uncheck()
  }
  /**
   * Convenience: skip both warm-up and cool-down so the fixture window
   * goes straight to PhaseWork. Most e2e flows want this.
   */
  async skipWarmupAndCooldown() {
    await this.disableWarmup()
    await this.disableCooldown()
  }
  async start() {
    await Promise.all([
      this.page.waitForURL(/\/live/),
      this.page.getByRole('button', { name: /^Start$/ }).click(),
    ])
  }

  // ── Internal ──────────────────────────────────────────────────────
  /**
   * Step a stepper from `from` to `to` by clicking the "−" or "+"
   * button inside the given testid container. Step size determines
   * how many clicks are needed.
   */
  private async stepFromTo(
    container: ReturnType<Page['getByTestId']>,
    from: number,
    to: number,
    step: number,
  ) {
    if (to === from) return
    const dir = to < from ? '−' : '+'
    const clicks = Math.round(Math.abs(to - from) / step)
    const btn = container.getByRole('button', { name: dir })
    for (let i = 0; i < clicks; i++) await btn.click()
  }
}
