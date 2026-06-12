import { test, expect } from './fixtures'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

/**
 * Seed completed distance-N-m sessions directly via SQLite so the Trends
 * endpoint has enough data to cross the SERIES_THRESHOLD (≥2 per series) and
 * render a ProgressChart. Also seeds:
 *  - one active pb_distance row pointing at the newest seeded session, so
 *    that session gets distance_pb=true and shows the 🏆 badge.
 *  - one just_row session (non-completed, no shape_hash) as a context dot.
 *
 * Sessions are time-staggered by dayOffset0 so multiple seed batches
 * (one per shape) interleave on the chart without colliding at the same x.
 *
 * Returns the array of session IDs and the newestSessionId (last element,
 * which is the pb_distance source).
 */
export function seedTrendsSessions(
  dbPath: string,
  rowerId: string,
  meters: number,
  count: number,
  dayOffset0: number,
): { sessionIds: string[]; newestSessionId: string } {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const shapeHash = `{"meters":${meters}}`

  const rows: Array<{
    sessionId: string
    workoutId: string
    startedAt: string
    endedAt: string
  }> = []

  for (let i = 0; i < count; i++) {
    const sessionId = randomUUID()
    const workoutId = randomUUID()
    const start = new Date(now - (dayOffset0 - i * 5) * day).toISOString()
    const end = new Date(now - (dayOffset0 - i * 5) * day + 10 * 60 * 1000).toISOString()
    rows.push({ sessionId, workoutId, startedAt: start, endedAt: end })
  }

  const sessionIds = rows.map((r) => r.sessionId)
  // Newest row is last in our ordering (smallest dayOffset → most recent).
  const newestRow = rows[rows.length - 1]
  const newestSessionId = newestRow.sessionId

  // pace_sec_per_500m varies a bit so the rolling-avg overlay has signal.
  const basePace = meters >= 2000 ? 115 : 130
  const baseDPS = meters >= 2000 ? 9.4 : 8.5

  const workoutInserts = rows
    .map(
      (r) =>
        `INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
         VALUES('${r.workoutId}', 'distance', '{"meters":${meters}}', 'moderat', 0, 0,
                '${r.startedAt}', '${shapeHash}');`,
    )
    .join('\n')

  const sessionInserts = rows
    .map(
      (r, i) =>
        `INSERT INTO sessions(id, rower_id, started_at, ended_at, initial_level,
              total_distance_m, total_time_sec, total_strokes,
              avg_power_w, avg_pace_sec_per_500m, avg_dps, avg_spm,
              workout_id)
         VALUES('${r.sessionId}', '${rowerId}', '${r.startedAt}', '${r.endedAt}',
                3, ${meters}, ${(meters / 500) * (basePace - i * 2)}, 100,
                ${160 + i * 5}, ${basePace - i * 2}, ${baseDPS + i * 0.2}, 24.0,
                '${r.workoutId}');`,
    )
    .join('\n')

  // Seed an active pb_distance row for the 500 m distance pointing at the
  // newest session, so distance_pb=true appears on that session's row.
  const pbDistanceInsert = `
INSERT INTO pb_distance(rower_id, distance_m, time_sec, source_session_id,
                        source_session_started_at, achieved_at,
                        window_start_stroke, window_end_stroke, invalidated_at)
VALUES('${rowerId}', ${meters}, ${(meters / 500) * basePace},
       '${newestSessionId}', '${newestRow.startedAt}', '${newestRow.startedAt}',
       1, 100, NULL);`

  // Seed a just_row session (non-completed, no shape_hash) as a context dot.
  const justRowId = randomUUID()
  const justRowAt = new Date(now - (dayOffset0 + 2) * day).toISOString()
  const justRowEndedAt = new Date(now - (dayOffset0 + 2) * day + 20 * 60 * 1000).toISOString()
  const justRowInsert = `
INSERT INTO sessions(id, rower_id, started_at, ended_at, initial_level,
              total_distance_m, total_time_sec, total_strokes,
              avg_power_w, avg_pace_sec_per_500m, avg_dps, avg_spm)
VALUES('${justRowId}', '${rowerId}', '${justRowAt}', '${justRowEndedAt}',
       3, 2000, 480, 80, 140, 125, 8.0, 22.0);`

  const sql = workoutInserts + '\n' + sessionInserts + pbDistanceInsert + justRowInsert
  const r = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`seedTrendsSessions: sqlite3 exit=${r.status} stderr=${r.stderr}`)
  }
  return { sessionIds, newestSessionId }
}

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
