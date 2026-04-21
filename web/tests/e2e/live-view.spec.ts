import { test, expect } from '@playwright/test'

// TODO(M3): This suite pre-dates RowerGate + the RowerStrip top bar and
// the theme switcher has moved off ProfilePage in the M3 slice. The
// visual snapshots (live-{xs,md,xl}.png) would all need re-capture and
// the theme-switcher test needs a new home once a settings UI for
// theme is decided. Skipping wholesale until that follow-up ships.
test.describe.skip('live-view visual + theme switcher (pre-M3)', () => {
  const VIEWPORTS = [
    { name: 'xs', width: 360, height: 640 },
    { name: 'md', width: 768, height: 1024 },
    { name: 'xl', width: 1440, height: 900 },
  ]

  for (const vp of VIEWPORTS) {
    test(`live view renders at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto('/')

      await expect(page.getByText('Split', { exact: true })).toBeVisible()
      await expect(page.getByText('Zeit', { exact: true })).toBeVisible()
      await expect(page.getByText('Distanz', { exact: true })).toBeVisible()
      await expect(page.getByText('SPM', { exact: true })).toBeVisible()
      await expect(page.getByText('Watt', { exact: true })).toBeVisible()

      await expect(page.getByRole('link', { name: /^Live/ })).toBeVisible()
      await expect(page.getByRole('link', { name: /^Historie/ })).toBeVisible()
      await expect(page.getByRole('link', { name: /^Profil/ })).toBeVisible()

      await expect(page).toHaveScreenshot(`live-${vp.name}.png`, {
        maxDiffPixelRatio: 0.02,
      })
    })
  }

  test('theme switcher flips html[data-theme]', async ({ page }) => {
    await page.goto('/profil')
    await page.getByRole('button', { name: 'Hell' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'Dunkel' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})
