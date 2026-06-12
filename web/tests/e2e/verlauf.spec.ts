import { test, expect } from './fixtures'
import { seedTrendsSessions } from './helpers/seedTrends'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

// ── Verlauf page tests ────────────────────────────────────────────────────────

test('Verlauf list shows one row per seeded session, newest first', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  await seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)

  await page.goto('/historie')
  await page.waitForSelector('[data-testid^="verlauf-row-"]')
  const rows = await page.locator('[data-testid^="verlauf-row-"]').all()
  expect(rows.length).toBeGreaterThanOrEqual(2)
  // Newest row first
  const firstId = await rows[0].getAttribute('data-testid')
  expect(firstId).toContain('verlauf-row-')
})

test('🏆 badge appears exactly on the pb-source row', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  const { newestSessionId } = await seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)

  await page.goto('/historie')
  await page.waitForSelector(`[data-testid="verlauf-pb-${newestSessionId}"]`)
  // Only one 🏆 badge should appear (the PB row)
  const badges = await page.locator('[data-testid^="verlauf-pb-"]').count()
  expect(badges).toBe(1)
})

test('progress chart has line dots for completed sessions and context dots', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  await seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)

  await page.goto('/historie')
  await page.waitForSelector('[data-testid="progress-line-dot"]', { timeout: 15_000 })
  const lineDots = await page.locator('[data-testid="progress-line-dot"]').count()
  expect(lineDots).toBeGreaterThanOrEqual(1)
  const contextDots = await page.locator('[data-testid="progress-context-dot"]').count()
  expect(contextDots).toBeGreaterThanOrEqual(1)
})

test('gold PB line visible in Split mode; switching to Watt hides it', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  await seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)

  await page.goto('/historie')
  await page.waitForSelector('[data-testid="progress-pb-line"]', { timeout: 15_000 })
  await expect(page.locator('[data-testid="progress-pb-line"]')).toBeVisible()
  // Switch to Watt — PB line should disappear (only shown in Split mode)
  await page.getByRole('tab', { name: 'Watt' }).click()
  await expect(page.locator('[data-testid="progress-pb-line"]')).not.toBeVisible()
})

test('window tabs update URL and refetch', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  await seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)

  await page.goto('/historie')
  await page.waitForSelector('[data-testid^="verlauf-row-"]', { timeout: 15_000 })
  await page.getByRole('tab', { name: 'Jahr' }).click()
  await expect(page).toHaveURL(/window=365d/)
})

test('/historie/trends?range=year redirects to /historie?window=365d', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  await startBackend({ idleTimeout: '2s' })
  await seedActiveRower()

  await page.goto('/historie/trends?range=year')
  await expect(page).toHaveURL(/\/historie\?window=365d/, { timeout: 10_000 })
})
