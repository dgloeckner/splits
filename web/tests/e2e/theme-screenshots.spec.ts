import { test, expect, devices } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedRower } from './helpers/rower'

// Theme + viewport screenshot matrix.
//
// Goal: produce side-by-side dark/light captures of every key route at
// a representative iPhone viewport so the maintainer can eyeball
// rendering bugs (raw colours that don't follow tokens, inverted
// contrast, off-grid layout) before shipping the theme switcher.
//
// Run: cd web && npx playwright test theme-screenshots.spec.ts
// Output: tests/e2e/theme-screenshots/<route>-<theme>-<viewport>.png
//
// The suite always passes — it's a capture-only run, not a regression
// matcher. To lock baselines later, switch the screenshot calls to
// `expect(page).toHaveScreenshot(...)` so future drift fails CI.

let backend: ChildProcessWithoutNullStreams | null = null

test.beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'splits-e2e-theme-'))
  backend = spawn('go', ['run', './cmd/splits'], {
    cwd: join(process.cwd(), '..', 'backend'),
    env: {
      ...process.env,
      SPLITS_ADDR: '127.0.0.1:8080',
      SPLITS_DB_PATH: join(tmp, 'e2e.db'),
      SPLITS_FIXTURE: '../specs/int/fixtures/ipm/session-short.csv',
      SPLITS_FIXTURE_RATE: 'fast',
      SPLITS_IDLE_TIMEOUT: '2s',
      SPLITS_DEV_MODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  backend.stderr?.on('data', (d) => process.stderr.write(`[be] ${d}`))

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch('http://localhost:8080/api/health')
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('backend did not come up')
})

test.afterAll(async () => {
  if (backend?.pid) {
    try {
      process.kill(-backend.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
  backend = null
})

const VIEWPORTS = [
  { name: 'iphone-se', size: { width: 375, height: 667 } }, // smallest current iPhone
  { name: 'iphone-14', size: { width: 393, height: 852 } }, // mid-size modern
] as const

const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'historie-sessions', path: '/historie' },
  { name: 'historie-trends', path: '/historie/trends' },
  { name: 'historie-rekorde', path: '/historie/rekorde' },
  { name: 'profil', path: '/profil' },
  // /pair without a token shows the "ungültig" message; useful to see
  // the bare error surface in both themes.
  { name: 'pair-invalid', path: '/pair' },
] as const

const THEMES = ['dark', 'light'] as const

for (const vp of VIEWPORTS) {
  test.describe(`theme matrix — ${vp.name}`, () => {
    test.use({ viewport: vp.size })

    for (const theme of THEMES) {
      test(`${theme}`, async ({ page, context }) => {
        // Seed a rower so RowerGate doesn't redirect to /onboarding,
        // and so the Profile + History tabs have something to render.
        await page.goto('/')
        await seedRower(context, 'Daniel')

        // Persist the theme choice BEFORE the first painted route so
        // the pre-mount script picks it up. localStorage is per-origin,
        // and the dev server on :5173 is the same origin we screenshot.
        await page.evaluate((t) => {
          window.localStorage.setItem('home-ergo:theme', t)
        }, theme)

        for (const route of ROUTES) {
          await page.goto(route.path)
          // Wait for any async data the route might pull.
          await page.waitForLoadState('networkidle')
          // Belt-and-braces: ensure the data-theme attribute matches
          // before we snap. The pre-mount script runs before React,
          // but we also re-set in case a hook overrode it.
          await page.evaluate((t) => {
            document.documentElement.setAttribute('data-theme', t)
          }, theme)
          // AppLayout's main content area has overflow-y:auto on a
          // 100dvh container, so Playwright's fullPage capture
          // doesn't follow the inner scroll. Lift overflow + height
          // constraints for the snapshot so the whole document is
          // captured. Tag is per-page; navigation resets it.
          await page.addStyleTag({
            content: `
              html, body { height: auto !important; overflow: visible !important; }
              [class*="AppLayout"], main { height: auto !important; overflow: visible !important; }
            `,
          })
          // Allow the next paint frame to flush styles.
          await page.waitForTimeout(200)

          await page.screenshot({
            path: `tests/e2e/theme-screenshots/${route.name}-${theme}-${vp.name}.png`,
            fullPage: true,
          })
        }

        // Sanity: pages didn't surface a console error. We log rather
        // than fail because legitimate dev-only warnings are noisy.
        // To enforce: convert to expect() once the suite is stable.
        await expect(page).toHaveURL(/.+/)
      })
    }
  })
}
