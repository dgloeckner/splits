// UX/visual audit — history (Verlauf + Rekorde) flow capture.
//
// Drives the /historie page through key states and captures screenshots at
// two viewports (phone + tablet). Every capture also writes a .layout.json
// sidecar with layout-level findings so the critique pass reads PNG + JSON
// together.
//
// Canonical heuristic checklist: docs/ux-audit-heuristics.md.
//
// Captures land in:
//   test-results/ux-audit/history/<viewport>/<state>.{png,layout.json}
//
// This spec is intentionally assertion-light — its job is to PRODUCE
// EVIDENCE for the critique pass, not to fail on its own findings.

import { test } from '../fixtures'
import { captureLayout } from './layout-audit'
import { seedTrendsSessions } from '../helpers/seedTrends'
import { spawnSync } from 'node:child_process'

const PHONE = { width: 390, height: 844 } // iPhone-ish, mobile-first default
const TABLET = { width: 820, height: 1180 } // iPad-ish

const VIEWPORTS = [
  { name: 'phone', size: PHONE },
  { name: 'tablet', size: TABLET },
]

/** Seed a pb_workout row so the Rekorde tab shows a workout card. */
function seedPbWorkout(
  dbPath: string,
  rowerId: string,
  sessionId: string,
  startedAt: string,
  shapeHash: string,
  meters: number,
): void {
  const sql = `
INSERT INTO pb_workout(rower_id, shape_hash, mode, params_json, value_kind, value,
                       source_session_id, source_session_started_at, achieved_at,
                       invalidated_at)
VALUES('${rowerId}', '${shapeHash}', 'distance', '{"meters":${meters}}', 'time_sec',
       ${(meters / 500) * 115}, '${sessionId}', '${startedAt}', '${startedAt}', NULL);`
  const r = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`seedPbWorkout: sqlite3 exit=${r.status} stderr=${r.stderr}`)
  }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

for (const v of VIEWPORTS) {
  test.describe(`history flow — ${v.name} (${v.size.width}x${v.size.height})`, () => {
    test.use({ viewport: v.size })

    test('capture: verlauf monat→jahr→alles, metric tabs, scrub, empty, rekorde', async ({
      startBackend,
      seedActiveRower,
      page,
    }) => {
      const handle = await startBackend({ idleTimeout: '120s' })
      const rower = await seedActiveRower()

      const out = (state: string) =>
        `../test-results/ux-audit/history/${v.name}/${state}.png`
      const snap = async (state: string) => {
        const path = out(state)
        await page.screenshot({ path, fullPage: true })
        await captureLayout(page, path)
      }

      // Seed sessions and PB data
      const { newestSessionId } = seedTrendsSessions(
        handle.dbPath,
        rower.id,
        500,
        3,
        15,
      )

      // Also seed a 5 km (5000 m) session for a second shape
      seedTrendsSessions(
        handle.dbPath,
        rower.id,
        5000,
        2,
        12,
      )

      // Seed pb_workout for the newest 500 m session
      const newestStartedAt = new Date(
        Date.now() - (15 - 2 * 5) * 24 * 60 * 60 * 1000,
      ).toISOString()
      seedPbWorkout(
        handle.dbPath,
        rower.id,
        newestSessionId,
        newestStartedAt,
        '{"meters":500}',
        500,
      )

      // 01 verlauf-monat — default window (30d)
      await page.goto('/historie')
      await page.waitForSelector('[data-testid^="verlauf-row-"]', { timeout: 15_000 })
      await snap('01-verlauf-monat')

      // 02 verlauf-jahr — click Jahr tab
      await page.getByRole('tab', { name: 'Jahr' }).click()
      await page.waitForTimeout(500)
      await snap('02-verlauf-jahr')

      // 03 verlauf-alles — click Alles tab
      await page.getByRole('tab', { name: 'Alles' }).click()
      await page.waitForTimeout(500)
      await snap('03-verlauf-alles')

      // 04 verlauf-metric-watt — back to Monat, switch to Watt metric
      await page.getByRole('tab', { name: 'Monat' }).click()
      await page.waitForTimeout(300)
      await page.getByRole('tab', { name: 'Watt' }).click()
      await page.waitForTimeout(300)
      await snap('04-verlauf-metric-watt')

      // 05 verlauf-metric-dps — switch to DPS metric
      await page.getByRole('tab', { name: 'DPS' }).click()
      await page.waitForTimeout(300)
      await snap('05-verlauf-metric-dps')

      // 06 verlauf-scrub — pointer-down + move on progress-capture
      // Switch back to Split first so PB line is visible during scrub
      await page.getByRole('tab', { name: 'Split' }).click()
      await page.waitForTimeout(300)
      const capture = page.locator('[data-testid="progress-capture"]').first()
      const box = await capture.boundingBox()
      if (box) {
        const midY = box.y + box.height / 2
        await page.mouse.move(box.x + box.width - 5, midY)
        await page.mouse.down()
        await page.mouse.move(box.x + 5, midY, { steps: 10 })
        await page.waitForTimeout(100)
        await snap('06-verlauf-scrub')
        await page.mouse.up()
      } else {
        // If capture element is not present (e.g. < MIN_SERIES_POINTS), skip
        await snap('06-verlauf-scrub-no-capture')
      }

      // 07 verlauf-empty — fresh rower (new backend, no sessions)
      // Navigate to a fresh rower context by going to /historie with empty data
      // We simulate this by going to a route that produces the empty state:
      // use window=30d but navigate there fresh; the seeded sessions are in
      // the past so might fall outside. Use the current setup but note this
      // may still show data — the audit evidence is what matters.
      //
      // For a true empty state, capture from the fresh rower angle:
      // The distance-capture spec already captures empty states; here we
      // capture the new Verlauf empty state (with its "Zeitraum erweitern" CTA).
      // The simplest approach: temporarily navigate to the empty state
      // by noting that in a fresh run the seedActiveRower will create a new rower.
      // Since we can't create a second rower in the same backend easily, we
      // capture the widen-button empty state by visiting with window=30d
      // and ensuring sessions land in > 30d ago. Our dayOffset0=15 means
      // sessions are 10–0 days ago, so they ARE in the 30d window.
      // Skip a true empty capture here — it's covered by distance-capture.spec.ts.
      // Instead, navigate to /historie with no sessions by starting a fresh backend.
      // For speed, just note: covered by distance-capture.spec.ts state 14.
      // We do capture the verlauf-widen state by using a window that's too narrow:
      // Sessions are 0–10 days old, so window=30d shows them. For empty, we'd need
      // sessions older than 30d. This is an audit spec so we proceed without it.
      // (A truly empty capture requires a second backend, which would bloat the spec.)

      // 08 rekorde — /historie/rekorde (with seeded pb_workout)
      await page.goto('/historie/rekorde')
      await page.waitForTimeout(1_000)
      await snap('08-rekorde')
    })

    test('capture: verlauf empty (fresh rower, no sessions)', async ({
      startBackend,
      seedActiveRower,
      page,
    }) => {
      await startBackend({ idleTimeout: '120s' })
      await seedActiveRower()

      const out = (state: string) =>
        `../test-results/ux-audit/history/${v.name}/${state}.png`
      const snap = async (state: string) => {
        const path = out(state)
        await page.screenshot({ path, fullPage: true })
        await captureLayout(page, path)
      }

      // 07 verlauf-empty — fresh rower with no sessions
      await page.goto('/historie')
      await page.waitForTimeout(1_000)
      await snap('07-verlauf-empty')

      // Also capture empty rekorde
      await page.goto('/historie/rekorde')
      await page.waitForTimeout(500)
      await snap('07b-rekorde-empty')
    })
  })
}
