import { expect, type Locator, type Page } from '@playwright/test'

export type RaceIntensity = 'Locker' | 'Moderat' | 'Hart' | 'All-out'

/**
 * Page object for the full race-mode flow:
 *
 *   / (Home) → Distanz/Rennen mode tile → Step2Dimension (race presets)
 *     → Step3Intensity → ConfirmScreen (Übersicht)
 *     → BereitScreen → RaceStartSequence (ATTENTION/SET/GO!)
 *     → RaceLiveView → FinishOverlay → RacePostScreen
 *
 * The methods are deliberately small so the canonical happy-path spec
 * (0016-05) reads as a sequence of phases the rower actually walks. All
 * selectors prefer `data-testid` where one is published; phase-text
 * selectors are used only when the underlying component has no stable
 * id (e.g. the "Distanz wählen" step heading).
 */
export class RaceFlowPage {
  constructor(private readonly page: Page) {}

  /** Navigate to "/" and open the Rennen (race) mode. */
  async gotoWorkoutFlow(): Promise<void> {
    await this.page.goto('/')
    await this.page.getByTestId('picker-race').click()
  }

  /** Step 2 (Dimension) — pick a race preset by exact meter value. */
  async pickDistance(meters: number): Promise<void> {
    // Race presets render labels like "500 m", "1 000 m", "2 000 m".
    const label = formatRaceLabel(meters)
    await this.page.getByRole('button', { name: label, exact: true }).click()
  }

  /** Step 3 (Intensity). */
  async pickIntensity(level: RaceIntensity): Promise<void> {
    await this.page.getByRole('button', { name: new RegExp(level, 'i') }).click()
  }

  /** Confirm screen (Übersicht): assert header, then tap Start. */
  async confirmRace(opts: { ghost?: boolean; pb?: boolean } = {}): Promise<void> {
    await expect(this.page.getByRole('heading', { name: /Übersicht/i })).toBeVisible()
    if (opts.ghost === false) {
      await this.page.getByLabel(/Synthetischer Geist/i).uncheck()
    }
    if (opts.pb === false) {
      await this.page.getByLabel(/Bestzeit/i).uncheck()
    }
    await Promise.all([
      this.page.waitForURL(/\/live/),
      this.page.getByRole('button', { name: /^Start$/ }).click(),
    ])
  }

  /** Tap the Bereit button — transitions reducer Confirmed → Bereit → Ceremony. */
  async tapBereit(): Promise<void> {
    await expect(this.page.getByTestId('bereit-screen')).toBeVisible()
    await this.page.getByTestId('bereit-button').click()
  }

  /**
   * Wait for the ceremony to reach the given phase
   * (`attention | set | go`). The ceremony component publishes
   * `data-ceremony-phase` on its overlay; we poll until it matches.
   */
  async waitForCeremonyStep(phase: 'attention' | 'set' | 'go', timeoutMs = 5_000): Promise<void> {
    await expect(
      this.page.locator(`[data-testid="race-start-sequence"][data-ceremony-phase="${phase}"]`),
    ).toBeVisible({ timeout: timeoutMs })
  }

  raceCanvas(): Locator {
    return this.page.getByTestId('race-canvas')
  }

  /**
   * Wait until the race-lifecycle reducer is in Live: the ceremony
   * overlay unmounts on the POST_GO tick, which is 1.5 s *after* the
   * visual "GO!" step first appears. Release the fixture only after
   * this; strokes that land while "GO!" is still on screen are pre-GO
   * for the reducer, and at `fast` pacing the whole CSV can flush in
   * that window.
   */
  async waitForLive(timeoutMs = 8_000): Promise<void> {
    await expect(this.page.getByTestId('race-start-sequence')).toBeHidden({ timeout: timeoutMs })
    await expect(this.raceCanvas()).toBeVisible()
  }

  /** Wait until the user's race distance (as rendered) reaches `minMeters`. */
  async waitForUserDistance(minMeters: number, timeoutMs = 15_000): Promise<void> {
    const canvasHost = this.page.locator('[data-component="race-canvas"]')
    await expect
      .poll(async () => Number(await canvasHost.getAttribute('data-user-distance-m')), {
        timeout: timeoutMs,
        message: `race distance did not reach ${minMeters} m`,
      })
      .toBeGreaterThanOrEqual(minMeters)
  }

  userBoat(): Locator {
    return this.page.getByTestId('boat-user')
  }

  ghostBoat(): Locator {
    return this.page.getByTestId('boat-ghost')
  }

  pbBoat(): Locator {
    return this.page.getByTestId('boat-pb')
  }

  falschstartToast(): Locator {
    return this.page.getByTestId('falschstart-toast')
  }

  /**
   * Wait for the Falschstart toast to render. The toast appears when the
   * reducer transitions Ceremony(ATTENTION|SET) → Live(Falschstart).
   */
  async waitForFalschstartToast(timeoutMs = 4_000): Promise<void> {
    await expect(this.falschstartToast()).toBeVisible({ timeout: timeoutMs })
  }

  /**
   * Wait for the Falschstart toast to auto-dismiss (~2 s after render).
   * Gives a small headroom over the toast's 2000 ms self-timeout.
   */
  async waitForFalschstartToastDismissed(timeoutMs = 4_000): Promise<void> {
    await expect(this.falschstartToast()).toBeHidden({ timeout: timeoutMs })
  }

  /** Wait for the FinishOverlay (latched final time). */
  async waitForFinishOverlay(timeoutMs = 45_000): Promise<void> {
    await expect(this.page.getByTestId('finish-overlay')).toBeVisible({
      timeout: timeoutMs,
    })
  }

  /** Wait for the post-race screen after session_end. */
  async waitForPostScreen(timeoutMs = 30_000): Promise<void> {
    await expect(this.page.getByTestId('race-post-screen')).toBeVisible({
      timeout: timeoutMs,
    })
  }

  /** The PB celebration stack LivePage mounts after session_end. */
  pbOverlay(): Locator {
    return this.page.getByTestId('pb-overlay')
  }

  /**
   * Tap Fertig on the FinishOverlay.
   *
   * Once session_end lands, LivePage stacks the PBOverlay (a modal scrim)
   * over the FinishOverlay — and in a fresh test DB the first finished
   * distance is always a PB. The scrim intercepts the tap, so a plain
   * `click()` retries against it until the test timeout. Dismiss the
   * stack ("Weiter" per card) whenever it is up, then tap; the outer
   * loop covers the overlay arriving between the check and the tap.
   */
  async tapFertig(): Promise<void> {
    const fertig = this.page.getByTestId('finish-fertig')
    await expect(fertig).toBeVisible()
    await expect(fertig).toBeEnabled()
    for (let attempt = 0; attempt < 5; attempt++) {
      for (let card = 0; card < 10 && (await this.pbOverlay().isVisible()); card++) {
        await this.pbOverlay().getByRole('button', { name: 'Weiter' }).click()
        await this.page.waitForTimeout(50)
      }
      try {
        await fertig.click({ timeout: 3_000 })
        return
      } catch {
        // The PB overlay raced in front of the button; dismiss and retry.
      }
    }
    await fertig.click()
  }

  // ── Abort affordance (0016-07) ────────────────────────────────────

  abortPill(): Locator {
    return this.page.getByTestId('abort-pill')
  }

  abortConfirmSheet(): Locator {
    return this.page.getByTestId('abort-confirm-sheet')
  }

  /** Tap the top-right Abbrechen pill — opens the confirmation sheet. */
  async tapAbbrechen(): Promise<void> {
    await expect(this.abortPill()).toBeVisible()
    await this.abortPill().click()
    await expect(this.abortConfirmSheet()).toBeVisible()
  }

  /** Tap the confirm button inside the confirmation sheet. */
  async confirmAbbrechen(): Promise<void> {
    await expect(this.abortConfirmSheet()).toBeVisible()
    await this.page.getByTestId('abort-confirm-confirm').click()
  }

  /** Tap the cancel button inside the confirmation sheet — no side effects. */
  async cancelAbbrechen(): Promise<void> {
    await expect(this.abortConfirmSheet()).toBeVisible()
    await this.page.getByTestId('abort-confirm-cancel').click()
    await expect(this.abortConfirmSheet()).toBeHidden()
  }
}

function formatRaceLabel(meters: number): string {
  // Matches `racePresets` in src/pages/workout/presets.ts.
  switch (meters) {
    case 500:
      return '500 m'
    case 1000:
      return '1 000 m'
    case 2000:
      return '2 000 m'
    case 5000:
      return '5 000 m'
    case 6000:
      return '6 000 m'
    case 10000:
      return '10 000 m'
    case 21097:
      return 'Halbmarathon'
    case 42195:
      return 'Marathon'
    default:
      throw new Error(`unsupported race preset meters: ${meters}`)
  }
}
