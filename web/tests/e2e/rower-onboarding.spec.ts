import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let backend: ChildProcessWithoutNullStreams | null = null

test.beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'splits-e2e-onboarding-'))
  backend = spawn('go', ['run', './cmd/splits'], {
    cwd: join(process.cwd(), '..', 'backend'),
    env: {
      ...process.env,
      SPLITS_ADDR: ':8080',
      // Non-localhost bind needs the dev-mode gate (T10), as in helpers/backend.ts.
      SPLITS_DEV_MODE: '1',
      SPLITS_DB_PATH: join(tmp, 'e2e.db'),
      SPLITS_FIXTURE: '../specs/int/fixtures/ipm/session-short.csv',
      SPLITS_FIXTURE_RATE: 'fast',
      SPLITS_IDLE_TIMEOUT: '1s',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  backend.stderr?.on('data', (d) => process.stderr.write(`[be] ${d}`))

  const healthDeadline = Date.now() + 60_000
  while (Date.now() < healthDeadline) {
    try {
      const r = await fetch('http://localhost:8080/api/health')
      if (r.ok) break
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
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
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch('http://localhost:8080/api/health', { signal: AbortSignal.timeout(200) })
      r.body?.cancel()
    } catch {
      return
    }
    await new Promise((r) => setTimeout(r, 100))
  }
})

test('fresh install → onboarding → live view → history badge', async ({ page, context }) => {
  await context.clearCookies()
  await page.goto('/')
  await expect(page).toHaveURL(/\/onboarding/)

  await page.getByLabel(/name/i).fill('Alice')
  await page.getByLabel(/gewicht/i).fill('70')
  await page.getByLabel(/größe/i).fill('172')
  await page.getByRole('button', { name: /weiter/i }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('toolbar', { name: /rudernde/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /aktivieren: alice/i })).toBeVisible()

  await page.goto('/historie')
  await expect(page.getByRole('button', { name: /aktivieren: alice/i })).toBeVisible()
})
