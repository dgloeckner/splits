import { test, expect } from './fixtures'
import { seedSessionSamples } from './helpers/seedSessionSamples'

const FIXTURE_M3 = '../specs/int/fixtures/ipm/session-m3-long.csv'

test.describe.configure({ mode: 'serial' }) // shares port 8080
test.setTimeout(60_000)

// #43: the session-detail charts take their y-domain from the working
// range (the analysis window), so the start-up bucket of a long piece
// no longer stretches the split axis to 1:20–3:00. A real fixture
// session is rowed, then its samples are replaced by the reconstructed
// 11.06.2026 5000 m session (start bucket 2:45, body ~1:48).
test('session charts: split axis spans the working range, start spike clipped', async ({
  startBackend,
  seedActiveRower,
  home,
  history,
  page,
  waitForEndedSession,
}, testInfo) => {
  const handle = await startBackend({ fixture: FIXTURE_M3, idleTimeout: '20s', fixtureDelay: '4s' })
  const rower = await seedActiveRower()
  await home.open()
  await home.startFreeRow()
  const ended = await waitForEndedSession(rower.id, 30_000)
  seedSessionSamples(handle.dbPath, ended.id)

  await page.setViewportSize({ width: 390, height: 844 })
  await history.openSessions()
  await history.openFirstSession()

  const splitChart = page.locator('figure').filter({ hasText: 'Split-Verlauf' })
  await splitChart.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('01-split-chart.png'), fullPage: true })

  // Y-tick labels are the left-edge <text> nodes in m:ss,t form.
  const labels = await splitChart.locator('svg text').allTextContents()
  const ySecs = labels
    .filter((t) => /^\d:\d\d,\d$/.test(t))
    .map((t) => t.replace(',', '.'))
    .map((t) => Number(t.slice(0, 1)) * 60 + Number(t.slice(2)))
  expect(ySecs.length).toBeGreaterThan(1)
  expect(Math.max(...ySecs)).toBeLessThanOrEqual(130) // no tick above 2:10
  expect(Math.min(...ySecs)).toBeGreaterThanOrEqual(95)

  await page.locator('figure').filter({ hasText: 'DPS-Verlauf' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('02-all-charts.png') })

  // All four charts keep their Ø line.
  await expect(page.getByTestId('session-chart-avg')).toHaveCount(4)

  // #45: each chart's Ø label reads exactly like the hero panel value.
  const avgLabels = await page.getByTestId('session-chart-avg').allTextContents()
  for (const [i, metric] of ['split', 'watt', 'spm', 'dps'].entries()) {
    const hero = await page.getByTestId(`detail-avg-${metric}`).textContent()
    expect(avgLabels[i].replace(/^Ø /, '')).toBe(hero)
  }

  // #40: one decimal separator on the whole page — no "1.5"-style number.
  const pageText = await page.locator('main, #root').first().innerText()
  expect(pageText).not.toMatch(/\d\.\d/)

  // No horizontal overflow at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
