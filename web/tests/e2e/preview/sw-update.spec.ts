import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { pickFreePort } from '../helpers/ports'
import {
  NEXT_BUILD_DIR,
  NEXT_BUILD_VERSION,
  spawnPreviewServer,
} from '../helpers/previewServer'
import type { ViteHandle } from '../helpers/viteServer'

/**
 * FEAT-0016 stage 5 (ADR-0023 §5): a new build never reloads the page by
 * itself. The rower is mid-session on the Live view when an unattended
 * deploy lands (the preview server switches from `dist` to `dist-next`
 * on the same origin and the real production SW finds it). Nothing
 * reloads; once the session has ended, the next visit to Home or Verlauf
 * shows the toast „Neue Version verfügbar — Neu laden", and only the tap
 * applies the new build.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOTS = resolve(__dirname, '..', '..', '..', 'test-results', 'sw-update')

test.setTimeout(120_000)

async function footerVersion(page: Page): Promise<string> {
  await page.getByTestId('bottom-nav-profil').click()
  const footer = page.getByTestId('build-version')
  await expect(footer).toBeVisible()
  return (await footer.textContent()) ?? ''
}

test('a deploy mid-session waits for the session to end and for „Neu laden"', async ({
  startBackend,
  seedActiveRower,
  fault,
  page,
}) => {
  // preview/fixtures' beforeEach reset only reaches the first spec file
  // that imports it; a previous spec may have left the proxy refusing.
  fault.setMode('pass')
  await startBackend()
  await seedActiveRower()

  // This spec's own origin, so it can swap the build underneath the page.
  const port = await pickFreePort()
  const origin = `http://127.0.0.1:${port}`
  let server: ViteHandle = await spawnPreviewServer({ port, backendUrl: fault.url })
  try {
    // Installed build A, controlled by its service worker.
    await page.goto(`${origin}/`)
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 30_000,
    })
    // A phone opens the installed app with A already in control — not the
    // page that first installed it.
    await page.reload()
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
    const before = await footerVersion(page)
    expect(before).not.toContain(NEXT_BUILD_VERSION)

    // Every full page load from here on counts against "never reloads".
    let loads = 0
    page.on('load', () => loads++)

    // Mid-session on the Live view.
    await page.getByTestId('bottom-nav-workout').click()
    await Promise.all([page.waitForURL(/\/live/), page.getByTestId('picker-just-row').click()])
    await expect
      .poll(async () => (await page.request.get(`${origin}/api/health`)).json(), { timeout: 15_000 })
      .toMatchObject({ session_open: true })

    // The 04:30 deploy: build B appears on the same origin, the SW finds
    // it and installs it.
    await server.kill()
    server = await spawnPreviewServer({ port, backendUrl: fault.url, outDir: NEXT_BUILD_DIR })
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.update()
    })
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistration())?.waiting != null,
      null,
      { timeout: 30_000 },
    )

    // Nothing reloads, nothing is offered while the session is open.
    await page.waitForTimeout(2_000)
    expect(loads).toBe(0)
    await expect(page).toHaveURL(/\/live/)
    await expect(page.getByText('Neue Version verfügbar')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/01-live-no-reload.png` })

    // The session ends („Beenden" ends it on the backend). The Live view
    // shows its summary — still mounted, still nothing offered.
    const ended = await page.request.post(`${origin}/api/v1/session/end`)
    expect(ended.ok()).toBe(true)
    await expect(page.getByTestId('session-ended-overlay')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Neue Version verfügbar')).toHaveCount(0)

    // „OK" leads Home: the deferred offer is made there.
    await page.getByTestId('session-ended-ok').click()
    await expect(page.getByTestId('picker-just-row')).toBeVisible()
    await expect(page.getByText('Neue Version verfügbar')).toBeVisible({ timeout: 10_000 })

    // Ignored: Profil still runs the old build — nothing applied it.
    expect(await footerVersion(page)).toBe(before)
    expect(loads).toBe(0)

    // Once that toast has gone, a tap on Verlauf offers it again — one
    // toast at a time, never a stack.
    await expect(page.getByText('Neue Version verfügbar')).toHaveCount(0, { timeout: 15_000 })
    await page.getByTestId('bottom-nav-historie').click()
    await expect(page.getByText('Neue Version verfügbar')).toHaveCount(1, { timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Neu laden' }).last()).toBeVisible({
      timeout: 10_000,
    })
    await page.screenshot({ path: `${SHOTS}/02-verlauf-toast.png` })
    expect(loads).toBe(0)

    // Only the tap applies it.
    await Promise.all([
      page.waitForEvent('load', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Neu laden' }).last().click(),
    ])
    expect(loads).toBe(1)
    const after = await footerVersion(page)
    expect(after).toContain(`splits ${NEXT_BUILD_VERSION}`)
    await page.getByTestId('build-version').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/03-profil-new-build.png`, fullPage: true })
  } finally {
    await server.kill()
  }
})
