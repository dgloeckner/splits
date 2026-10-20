import { spawnSync } from 'node:child_process'
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

// ── #48: context-dot legend, strip chip, range caption ───────────────────────

const PHONE = { width: 390, height: 844 }

// Press beside a dot, then drag onto it: the scrubber snaps to the dot
// nearest the pointer once the drag passes its threshold.
async function scrubOnto(page: import('@playwright/test').Page, dot: import('@playwright/test').Locator) {
  const box = await dot.boundingBox()
  if (!box) throw new Error('dot has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x + 14, y)
  await page.mouse.down()
  await page.mouse.move(x + 7, y)
  await page.mouse.move(x, y)
}

// Day of month, in the browser's zone, of a session seeded `daysAgo`.
function dayOfMonth(page: import('@playwright/test').Page, daysAgo: number): Promise<number> {
  return page.evaluate((d) => new Date(Date.now() - d * 86_400_000).getDate(), daysAgo)
}

test('#48 walkthrough: legend, strip chip on a context dot, range caption', async ({
  startBackend,
  seedActiveRower,
  page,
}, testInfo) => {
  await page.setViewportSize(PHONE)
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  await seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)

  await page.goto('/historie')
  const caption = page.getByTestId('verlauf-range-caption')
  await expect(caption).toHaveText(/^\d{1,2}\. \S{3}( \d{4})? – \d{1,2}\. \S{3} \d{4}$/, { timeout: 15_000 })
  const monthCaption = await caption.textContent()

  await expect(page.getByTestId('progress-line-dot')).toHaveCount(3)
  await expect(page.getByTestId('progress-context-dot')).toHaveCount(1)
  const legend = page.getByTestId('progress-legend')
  await expect(legend).toHaveText(/500 m\s*andere Sessions/)
  await page.screenshot({ path: testInfo.outputPath('01-monat-legend.png'), fullPage: true })

  // Grey dot: the strip names the workout and drops the line delta.
  await scrubOnto(page, page.getByTestId('progress-context-dot'))
  const shape = page.getByTestId('progress-strip-shape')
  await expect(shape).toHaveText('Just Row')
  const strip = page.getByTestId('progress-strip')
  await expect(strip).toHaveText(new RegExp(`^${await dayOfMonth(page, 17)}\\. `))
  await expect(page.getByTestId('progress-strip-delta')).toHaveCount(0)
  const jrRow = page.locator('[data-testid^="verlauf-row-"]', { hasText: 'Just Row' })
  expect(await shape.textContent()).toBe(await jrRow.locator('span').nth(1).textContent())
  const plotTopOnContext = (await page.getByTestId('progress-capture').boundingBox())?.y
  await page.screenshot({ path: testInfo.outputPath('02-scrub-context-dot.png'), fullPage: true })
  await page.mouse.up()

  // Line dot: delta back, no chip.
  await scrubOnto(page, page.getByTestId('progress-line-dot').last())
  await expect(page.getByTestId('progress-strip-delta')).toBeVisible()
  await expect(strip).toHaveText(new RegExp(`^${await dayOfMonth(page, 5)}\\. `))
  await expect(shape).toHaveCount(0)
  // Hiding the delta must not reflow the strip and move the chart.
  expect((await page.getByTestId('progress-capture').boundingBox())?.y).toBe(plotTopOnContext)
  await page.screenshot({ path: testInfo.outputPath('03-scrub-line-dot.png'), fullPage: true })
  await page.mouse.up()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  await page.getByRole('tab', { name: 'Jahr' }).click()
  await expect(page).toHaveURL(/window=365d/)
  await expect(caption).not.toHaveText(monthCaption ?? '')
  await expect(caption).toHaveText(/^\d{1,2}\. \S{3} \d{4} – \d{1,2}\. \S{3} \d{4}$/)
  await page.screenshot({ path: testInfo.outputPath('04-jahr-caption.png'), fullPage: true })
})

test('#48: no legend without context dots', async ({ startBackend, seedActiveRower, page }) => {
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  await seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)
  // Drop the just_row context dot the helper adds.
  const r = spawnSync('sqlite3', [handle.dbPath,
    `DELETE FROM sessions WHERE rower_id = '${rower.id}' AND workout_id IS NULL;`], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)

  await page.goto('/historie')
  await expect(page.getByTestId('progress-line-dot')).toHaveCount(3, { timeout: 15_000 })
  await expect(page.getByTestId('progress-legend')).toHaveCount(0)
})

test('#48: range caption in the empty state', async ({ startBackend, seedActiveRower, page }) => {
  await startBackend({ idleTimeout: '2s' })
  await seedActiveRower()

  await page.goto('/historie?window=30d')
  await expect(page.getByTestId('verlauf-empty')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('verlauf-range-caption')).toHaveText(/^\d{1,2}\. \S{3}( \d{4})? – \d{1,2}\. \S{3} \d{4}$/)
})
