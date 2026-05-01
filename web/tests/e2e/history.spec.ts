import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedRower } from './helpers/rower'

let backend: ChildProcessWithoutNullStreams | null = null

test.beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'splits-e2e-history-'))
  backend = spawn('go', ['run', './cmd/splits'], {
    cwd: join(process.cwd(), '..', 'backend'),
    env: {
      ...process.env,
      SPLITS_ADDR: ':8080',
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

  // Wait for at least one completed (ended_at non-null) session.
  for (let i = 0; i < 100; i++) {
    const r = await fetch('http://localhost:8080/api/v1/sessions')
    const body = (await r.json()) as { sessions: { ended_at?: string }[] }
    if (body.sessions.some((s) => s.ended_at)) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('no completed session appeared')
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

test('history list shows a completed session; detail page renders charts', async ({ page, context }) => {
  await seedRower(context)
  await page.goto('/historie')
  const firstRow = page.locator('a[href^="/historie/"]').first()
  await expect(firstRow).toBeVisible({ timeout: 10_000 })
  await firstRow.click()
  await expect(page.getByText(/Split-Verlauf/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Watt-Verlauf/)).toBeVisible()
  await expect(page.getByText(/SPM-Verlauf/)).toBeVisible()
})
