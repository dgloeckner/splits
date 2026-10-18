import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { seedTrendsSessions } from '../helpers/seedTrends'

/**
 * Issue #3 (epic #1, ADR-0021): with a warm SW cache, the offline
 * trainer demo renders against the *production* service worker whatever
 * the failure shape — a hanging connection, a 502 from the proxy, or an
 * evicted IndexedDB bag. Failures are injected below the SW by the fault
 * proxy (see preview/fixtures.ts), never via `route()`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = '../specs/int/fixtures/ipm/session-short.csv'
const SCREENSHOT_ROOT = resolve(__dirname, '..', '..', '..', 'test-results', 'offline-preview')

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

// At home: the SW controls the page *before* the pack runs, so every
// pack read lands in the SW runtime cache. Wiping keyval-store (cursor
// + bag) forces a full re-pack on the reload.
async function packAtHome(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  })
  // Also drop the bootstrap mirror: a seconds-old mirror would keep the
  // bootstrap queries from refetching, so they'd never reach the SW.
  await page.evaluate(() => {
    indexedDB.deleteDatabase('keyval-store')
    localStorage.removeItem('splits:bootstrap')
  })
  await page.reload()
  // The persister is throttled and a full navigation drops unflushed
  // writes; Verlauf decides "im Rucksack?" from the bag (issue #9), so
  // stay on the page until the packed sessions are on disk, then check
  // the Profil pack status via in-app navigation.
  await expect
    .poll(() => page.evaluate(persistedSessionCount), { timeout: 30_000 })
    .toBeGreaterThan(0)
  await page.getByRole('link', { name: /profil/i }).click()
  await expect(page.getByTestId('offline-stand')).toBeVisible({ timeout: 15_000 })
}

// Number of ['sessions', id] queries in the persisted react-query bag.
function persistedSessionCount(): Promise<number> {
  return new Promise((resolve) => {
    const open = indexedDB.open('keyval-store')
    // Never create the DB ourselves: an empty v1 without the `keyval`
    // store would break idb-keyval's own open.
    open.onupgradeneeded = () => open.transaction?.abort()
    open.onerror = () => resolve(0)
    open.onsuccess = () => {
      const db = open.result
      if (!db.objectStoreNames.contains('keyval')) return resolve(0)
      const get = db.transaction('keyval').objectStore('keyval').get('splits:rq-cache')
      get.onerror = () => resolve(0)
      get.onsuccess = () => {
        const queries: Array<{ queryKey: unknown[] }> = get.result?.clientState?.queries ?? []
        db.close()
        resolve(
          queries.filter((q) => q.queryKey[0] === 'sessions' && q.queryKey.length === 2).length,
        )
      }
    }
  })
}

async function airplaneMode(
  context: BrowserContext,
  fault: { setMode: (m: 'pass' | 'refuse') => void },
  on: boolean,
): Promise<void> {
  fault.setMode(on ? 'refuse' : 'pass')
  await context.setOffline(on)
}

async function seed(
  startBackend: (o?: { idleTimeout?: string }) => Promise<{ dbPath: string }>,
  seedActiveRower: () => Promise<{ id: string }>,
) {
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  await seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)
  return rower
}

// The trainer demo: Home hero → Verlauf → detail → Rekorde, all from
// cache with the Stand banner.
async function expectOfflineDemo(
  page: Page,
  { shots, chart = false }: { shots?: string; chart?: boolean } = {},
): Promise<void> {
  const shot = async (name: string) => {
    if (shots) await page.screenshot({ path: `${shots}/${name}.png` })
  }

  const t0 = Date.now()
  await page.goto('/')
  await expect(page.getByTestId('ergo-offline-hero')).toBeVisible({ timeout: 15_000 })
  expect(Date.now() - t0).toBeLessThan(15_000)
  await expect(page.getByTestId('ergo-offline-hero')).toContainText('Stand:')
  await expect(page.getByTestId('picker-just-row')).toBeDisabled()
  await shot('01-home-offline-hero')

  await page.getByTestId('ergo-offline-cta').click()
  await expect(page.getByTestId('ergo-stand-banner')).toBeVisible({ timeout: 15_000 })
  await page.waitForSelector('[data-testid^="verlauf-row-"]', { timeout: 15_000 })
  await expect(page.getByTestId('ergo-stand-banner')).toContainText('Stand:')
  await shot('02-verlauf')

  await page.locator('a[data-testid^="verlauf-row-"]').first().click()
  await expect(page.getByTestId('detail-total-distance')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('ergo-stand-banner')).toBeVisible()
  // Split/watt/SPM series from the cached samples (seeded-only sessions
  // have no samples, so only the rowed-session walkthrough checks this).
  if (chart) {
    // Each series is a smoothed curve through the samples; the empty
    // chart frame only has straight gridlines.
    const seriesPaths = () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll('svg path[d]')].filter(
            (p) => (p.getAttribute('d') ?? '').split('C').length - 1 >= 2,
          ).length,
      )
    await expect.poll(seriesPaths).toBeGreaterThanOrEqual(3)
  }
  await shot('03-session-detail')

  await page.goto('/historie/rekorde')
  await expect(page.getByTestId('ergo-stand-banner')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('rekorde-empty')).toHaveCount(0)
  await shot('04-rekorde')
}

test('hanging connection: the trainer demo renders from the SW cache', async ({
  startBackend,
  seedActiveRower,
  waitForEndedSession,
  fault,
  page,
}) => {
  // One real rowed session (fixture replay → strokes + samples), so the
  // cached detail has a chart to draw, on top of the seeded history.
  const handle = await startBackend({
    fixture: FIXTURE,
    fixtureRate: 'fast',
    // Playback starts 6 s after boot, after "Nur rudern" opened the
    // session (earlier strokes are dropped); the idle timeout must
    // outlast that gap, or the still-empty session is discarded.
    fixtureDelay: '6s',
    idleTimeout: '10s',
  })
  const rower = await seedActiveRower()
  await page.goto('/')
  await Promise.all([page.waitForURL(/\/live/), page.getByTestId('picker-just-row').click()])
  await waitForEndedSession(rower.id, 45_000)
  // Seed only now: seeded sessions are already ended and would satisfy
  // waitForEndedSession before the rowed one closes.
  seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)

  await packAtHome(page)
  await page.getByTestId('offline-stand').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SCREENSHOT_ROOT}/hang/00-profil-packed.png` })

  fault.setMode('hang')
  await expectOfflineDemo(page, { shots: `${SCREENSHOT_ROOT}/hang`, chart: true })
})

test('502 from the proxy: cached bodies win over the error', async ({
  startBackend,
  seedActiveRower,
  fault,
  page,
}) => {
  await seed(startBackend, seedActiveRower)
  await packAtHome(page)

  fault.setMode('502')
  await expectOfflineDemo(page)
  // A cached path answered 502 upstream → the page gets the cached 200;
  // the uncached probe still sees the 502.
  const res = await page.evaluate(async () => {
    const rowers = await fetch('/api/v1/rowers')
    const health = await fetch('/api/health', { cache: 'no-store' })
    return { rowers: rowers.status, body: await rowers.text(), health: health.status }
  })
  expect(res.rowers).toBe(200)
  expect(JSON.parse(res.body).rowers).toHaveLength(1)
  expect(res.health).toBe(502)
})

test('IndexedDB evicted: the gate passes from the SW cache alone', async ({
  startBackend,
  seedActiveRower,
  fault,
  page,
}) => {
  await seed(startBackend, seedActiveRower)
  await packAtHome(page)

  fault.setMode('hang')
  await page.evaluate(() => {
    indexedDB.deleteDatabase('keyval-store')
  })
  await page.goto('/')
  await expect(page.getByTestId('ergo-offline-hero')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('picker-just-row')).toBeDisabled()
})

test('backend up: the network wins over a cached bootstrap', async ({
  startBackend,
  seedActiveRower,
  page,
  context,
}) => {
  const rower = await seed(startBackend, seedActiveRower)
  await packAtHome(page)

  const renamed = 'Umbenannt-' + Math.random().toString(36).slice(2, 8)
  const patch = await context.request.patch(`/api/v1/rowers/${rower.id}`, {
    data: { name: renamed },
  })
  expect(patch.ok()).toBe(true)

  // Through the SW (which holds the old name in splits-api-bootstrap).
  await page.goto('/')
  const body = await page.evaluate(async () => (await fetch('/api/v1/rowers')).text())
  expect(body).toContain(renamed)
  await expect(page.getByTestId('ergo-offline-hero')).toHaveCount(0)
})

// Issue #4: airplane mode (navigator.onLine === false). With react-query's
// default networkMode 'online' the queries pause and never reach the SW.
// Chromium's setOffline does not cover the SW's own fetches, so the
// fault proxy additionally drops every /api connection ('refuse').
test('airplane mode: the trainer demo renders, and recovers when back online', async ({
  startBackend,
  seedActiveRower,
  fault,
  page,
  context,
}) => {
  await seed(startBackend, seedActiveRower)
  await packAtHome(page)

  await airplaneMode(context, fault, true)
  await expectOfflineDemo(page, { shots: `${SCREENSHOT_ROOT}/airplane` })

  // Back online with the backend up: the hero goes away without a reload
  // (probe loop + `online` event).
  await page.goto('/')
  await expect(page.getByTestId('ergo-offline-hero')).toBeVisible({ timeout: 15_000 })
  await airplaneMode(context, fault, false)
  await expect(page.getByTestId('ergo-offline-hero')).toHaveCount(0, { timeout: 30_000 })
})

test('airplane mode, empty caches: the gate says „Ergo nicht erreichbar“, never spins', async ({
  startBackend,
  seedActiveRower,
  fault,
  page,
  context,
}) => {
  await seed(startBackend, seedActiveRower)
  await packAtHome(page)

  await page.evaluate(async () => {
    indexedDB.deleteDatabase('keyval-store')
    await caches.delete('splits-api-read')
    await caches.delete('splits-api-bootstrap')
  })
  await airplaneMode(context, fault, true)
  await page.goto('/')
  await expect(page.getByText('Ergo nicht erreichbar')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Verbinde zum Backend…')).toHaveCount(0)
  await page.screenshot({ path: `${SCREENSHOT_ROOT}/airplane/05-empty-caches-gate.png` })
})

// The B2 shape that bites in practice: react-query's onlineManager only
// learns about offline from the `offline` event, so the trap is going
// offline *while the app is open*. Every query mounted afterwards is
// paused under networkMode 'online' and never asks the SW cache.
test('airplane mode mid-session: in-app navigation still reaches the SW cache', async ({
  startBackend,
  seedActiveRower,
  fault,
  page,
  context,
}) => {
  await seed(startBackend, seedActiveRower)
  await packAtHome(page)

  // Boot without the IndexedDB bag but with a fresh pack cursor (so the
  // pack does not refill memory): only the SW cache holds the history,
  // nothing beyond the bootstrap is in react-query's memory.
  fault.setMode('refuse')
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('keyval-store')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction('keyval', 'readwrite')
          tx.objectStore('keyval').delete('splits:rq-cache')
          tx.oncomplete = () => {
            open.result.close()
            resolve()
          }
        }
      }),
  )
  await page.goto('/')
  await expect(page.getByTestId('ergo-offline-hero')).toBeVisible({ timeout: 15_000 })

  await airplaneMode(context, fault, true) // fires `offline` in the page
  await page.getByTestId('ergo-offline-cta').click()
  await page.waitForSelector('[data-testid^="verlauf-row-"]', { timeout: 15_000 })
  await page.getByRole('link', { name: 'Rekorde' }).click()
  await expect(page.getByTestId('ergo-stand-banner')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('rekorde-empty')).toHaveCount(0)
})

// Issue #5 / ADR-0021: local-first boot. After one session at home the
// localStorage bootstrap mirror alone renders Home — IndexedDB and the
// SW API caches evicted, the connection hanging.
test('local-first boot: the mirror renders Home with every other cache gone', async ({
  startBackend,
  seedActiveRower,
  fault,
  page,
}) => {
  await seed(startBackend, seedActiveRower)
  await packAtHome(page)
  expect(await page.evaluate(() => localStorage.getItem('splits:bootstrap'))).not.toBeNull()

  fault.setMode('hang')
  await page.evaluate(async () => {
    indexedDB.deleteDatabase('keyval-store')
    await caches.delete('splits-api-read')
    await caches.delete('splits-api-bootstrap')
  })
  await page.goto('/')

  // First paint: the rower is there, starts held, no verdict yet.
  await expect(page.getByTestId('ergo-searching')).toHaveText('Suche Ergo…')
  await expect(page.getByTestId('picker-just-row')).toBeDisabled()
  await expect(page.getByTestId('ergo-offline-hero')).toHaveCount(0)
  await page.screenshot({ path: `${SCREENSHOT_ROOT}/local-first/01-searching.png` })

  // The probe times out → the hero; never the bootstrap / diagnostic screen.
  await expect(page.getByTestId('ergo-offline-hero')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('ergo-searching')).toHaveCount(0)
  await expect(page.getByTestId('picker-just-row')).toBeDisabled()
  await expect(page.getByTestId('bootstrap-offline')).toHaveCount(0)
  await expect(page.getByText('Backend nicht erreichbar')).toHaveCount(0)
  await page.screenshot({ path: `${SCREENSHOT_ROOT}/local-first/02-hero.png` })
})

test('local-first boot at home: no hero flash, starts live within a second', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  await seed(startBackend, seedActiveRower)
  await packAtHome(page)

  await page.goto('/')
  await expect(page.getByTestId('picker-just-row')).toBeVisible()
  await expect(page.getByTestId('ergo-searching')).toHaveCount(0, { timeout: 1_000 })
  await expect(page.getByTestId('picker-just-row')).toBeEnabled()
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    expect(await page.getByTestId('ergo-offline-hero').count()).toBe(0)
    await page.waitForTimeout(100)
  }
  await page.screenshot({ path: `${SCREENSHOT_ROOT}/local-first/03-at-home.png` })
})
