import { test, expect } from './fixtures'
import { seedTrendsSessions } from './helpers/seedTrends'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)
test.use({ serviceWorkers: 'block' })

test('packed at home, history demo works at the club', async ({
  startBackend,
  seedActiveRower,
  page,
  context,
}) => {
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  await seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)

  // At home: open the app, let the boot pack run (idle-scheduled).
  await page.goto('/')
  await page.goto('/profil')
  await expect(page.getByTestId('offline-stand')).toBeVisible({ timeout: 30_000 })

  // At the club: no route to the backend.
  await context.route('**/api/**', (route) => route.abort('connectionrefused'))

  // Home: hero card with CTA; start affordances dimmed.
  await page.goto('/')
  await expect(page.getByTestId('ergo-offline-hero')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('picker-just-row')).toBeDisabled()

  // CTA → Verlauf renders from the bag, with the banner.
  await page.getByTestId('ergo-offline-cta').click()
  await expect(page.getByTestId('ergo-stand-banner')).toBeVisible()
  await page.waitForSelector('[data-testid^="verlauf-row-"]', { timeout: 15_000 })
  await expect(page.getByTestId('ergo-stand-banner')).toContainText('Stand:')

  // A cached row opens; detail renders from the bag with the banner.
  await page.locator('a[data-testid^="verlauf-row-"]').first().click()
  await expect(page.getByTestId('detail-total-distance')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('ergo-stand-banner')).toBeVisible()

  // Rekorde renders from the bag (seed includes a distance PB).
  await page.goto('/historie/rekorde')
  await expect(page.getByTestId('ergo-stand-banner')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('rekorde-empty')).toHaveCount(0)
})

test('reachable session leaves no offline artefacts in the UI', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  await startBackend({ idleTimeout: '2s' })
  await seedActiveRower()
  await page.goto('/')
  await expect(page.getByTestId('ergo-offline-hero')).toHaveCount(0)
  await page.goto('/historie')
  await expect(page.getByTestId('ergo-stand-banner')).toHaveCount(0)
})
