import { expect, type Page } from '@playwright/test'

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
}
