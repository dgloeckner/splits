import { expect, type Page } from '@playwright/test'

/**
 * "/" — workout picker. The Hero "Nur rudern" button starts a free
 * row session immediately; the three mode tiles route to the
 * workout-flow wizard.
 */
export class HomePage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto('/')
    await this.expectVisible()
  }

  async expectVisible() {
    await expect(this.page.getByTestId('picker-just-row')).toBeVisible()
  }

  async startFreeRow() {
    await Promise.all([
      this.page.waitForURL(/\/live/),
      this.page.getByTestId('picker-just-row').click(),
    ])
  }

  async pickDistance() {
    await this.page.getByTestId('picker-distance').click()
  }

  async pickTime() {
    await this.page.getByTestId('picker-time').click()
  }

  async pickIntervals() {
    await this.page.getByTestId('picker-intervals').click()
  }
}
