import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let backend: ChildProcessWithoutNullStreams | null = null

test.beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'homeergo-e2e-'))
  backend = spawn('go', ['run', './cmd/homeergo'], {
    cwd: join(process.cwd(), '..', 'backend'),
    env: {
      ...process.env,
      HOMEERGO_ADDR: ':8080',
      HOMEERGO_DB_PATH: join(tmp, 'e2e.db'),
      HOMEERGO_FIXTURE: 'specs/int/fixtures/ipm/session-short.csv',
      HOMEERGO_FIXTURE_RATE: 'fast',
      HOMEERGO_IDLE_TIMEOUT: '60s',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Wait for /api/health.
  const deadline = Date.now() + 15_000
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
  backend?.kill('SIGINT')
  backend = null
})

test('live view shows real split from backend fixture', async ({ page }) => {
  await page.goto('/')
  // With fast-pacing fixture, strokes arrive within ~1 s.
  await expect(page.locator('text=/^\\d+:\\d{2}\\.\\d$/').first()).toBeVisible({ timeout: 5000 })
  // Confirm we moved off em-dash idle state for at least one numeric field.
  const zeitValue = await page
    .getByText('Zeit', { exact: true })
    .locator('xpath=following-sibling::span')
    .first()
    .innerText()
  expect(zeitValue).not.toBe('—')
})
