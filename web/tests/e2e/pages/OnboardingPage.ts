import { expect, type Page } from '@playwright/test'

/**
 * /onboarding form for the first rower on a fresh device.
 */
export class OnboardingPage {
  constructor(private readonly page: Page) {}

  async expectVisible() {
    await expect(this.page).toHaveURL(/onboarding/)
  }

  async createRower(name: string) {
    await this.page.getByLabel(/Name/i).first().fill(name)
    await this.page
      .getByRole('button', { name: /Anlegen|Erstellen|Speichern|Weiter/i })
      .first()
      .click()
  }
}
