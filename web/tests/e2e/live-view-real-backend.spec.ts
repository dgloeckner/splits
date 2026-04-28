import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedRower } from './helpers/rower'

let backend: ChildProcessWithoutNullStreams | null = null

test.beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'homeergo-e2e-'))
  backend = spawn('go', ['run', './cmd/splits'], {
    cwd: join(process.cwd(), '..', 'backend'),
    env: {
      ...process.env,
      HOMEERGO_ADDR: ':8080',
      HOMEERGO_DB_PATH: join(tmp, 'e2e.db'),
      HOMEERGO_FIXTURE: '../specs/int/fixtures/ipm/session-short.csv',
      HOMEERGO_FIXTURE_RATE: 'fast',
      HOMEERGO_IDLE_TIMEOUT: '60s',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  backend.stderr?.on('data', (d) => process.stderr.write(`[be] ${d}`))
  // Wait for /api/health. go run needs time to compile on first run.
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
  // Wait for port 8080 to free so the next spec can bind it.
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

test('live view shows real split from backend fixture', async ({ page, context }) => {
  await seedRower(context)
  await page.goto('/')
  // Fast-pacing fixture may emit session_end (which clears stroke state)
  // before we finish reading. Assert on the mid-session signal: the hero's
  // split pace becomes a real m:ss.d value once the reducer has 2+ strokes.
  const split = page.locator('.tnum').filter({ hasText: /^\d+:\d{2}\.\d$/ }).first()
  await expect(split).toBeVisible({ timeout: 10_000 })
})
