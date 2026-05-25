import { test, expect } from './fixtures'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

/**
 * Seed `count` completed distance-N-m sessions directly via SQLite so the
 * Trends endpoint has enough data to cross the SERIES_THRESHOLD (≥3) and
 * render a TrendsChart. This bypasses the need to replay a fixture
 * `count` times, keeping the test fast and deterministic.
 *
 * Sessions are time-staggered by `dayOffset0` so multiple seed batches
 * (one per shape) interleave on the chart without colliding at the same x.
 *
 * Shape hash stored as the canonical-params string itself (matches what
 * trends_test.go uses for fixture rows; the trends API serves it back
 * verbatim as `key.shape_hash`).
 */
function seedTrendsSessions(
  dbPath: string,
  rowerId: string,
  meters: number,
  count: number,
  dayOffset0: number,
): string[] {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const sessionIds: string[] = []
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
    sessionIds.push(sessionId)
  }

  // pace_sec_per_500m varies a bit so the rolling-avg overlay has signal
  // and the strip's value/delta has something non-trivial to render.
  const basePace = meters >= 2000 ? 115 : 130
  const baseDPS = meters >= 2000 ? 9.4 : 8.5
  const baseSPI = meters >= 2000 ? 9.5 : 7.0

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
              avg_power_w, avg_pace_sec_per_500m, avg_dps, avg_spi, avg_spm,
              workout_id)
         VALUES('${r.sessionId}', '${rowerId}', '${r.startedAt}', '${r.endedAt}',
                3, ${meters}, ${(meters / 500) * (basePace - i * 2)}, 100,
                ${160 + i * 5}, ${basePace - i * 2}, ${baseDPS + i * 0.2}, ${baseSPI + i * 0.1}, 24.0,
                '${r.workoutId}');`,
    )
    .join('\n')

  const sql = workoutInserts + '\n' + sessionInserts
  const r = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`seedTrendsSessions: sqlite3 exit=${r.status} stderr=${r.stderr}`)
  }
  return sessionIds
}

test('trends scrubber: drag updates strip; dot tap opens session detail', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  // Single-shape seed: only 500 m, 3 sessions. One-line scrub drags the
  // primary row from the newest (rightmost) point to the oldest, asserting
  // the value text changes; tap on the middle dot navigates to its session.
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  const sessionIds = seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)
  expect(sessionIds).toHaveLength(3)

  await page.goto('/historie/trends?range=month')
  await expect(page.getByTestId('trends-chart-capture').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId('trends-strip-date').first()).toBeVisible()

  const firstStripRow = page.getByTestId(/^trends-strip-row-/).first()
  const idleText = (await firstStripRow.textContent()) ?? ''

  const capture = page.getByTestId('trends-chart-capture').first()
  const box = await capture.boundingBox()
  if (!box) throw new Error('trends-chart-capture bounding box missing')

  const midY = box.y + box.height / 2
  // Drag right→left to land scrubX on the oldest dot (different pace from
  // idle/newest). The hook enters scrubbing after ≥10 px movement.
  await page.mouse.move(box.x + box.width - 5, midY)
  await page.mouse.down()
  await page.mouse.move(box.x + 5, midY, { steps: 15 })
  await page.waitForTimeout(100)
  const scrubbedText = (await firstStripRow.textContent()) ?? ''
  await page.mouse.up()

  expect(scrubbedText).not.toBe(idleText)

  // Wait for the 3 s post-release to expire before tapping a dot.
  await page.waitForTimeout(3_500)

  // useChartScrubber compares localX (= clientX - captureRect.left) against
  // dots[i].x (viewBox coordinates from toX()). Click at captureRect.left +
  // 165 to target dot1 (middle, viewBox x = PLOT_LEFT + 0.5 * PLOT_W = 165).
  const captureForTapBox = await capture.boundingBox()
  if (!captureForTapBox) throw new Error('capture bounding box missing for tap test')
  const dot1ClickX = captureForTapBox.x + 34 + 0.5 * 262 // = captureForTapBox.x + 165
  const dot1ClickY = captureForTapBox.y + captureForTapBox.height / 2

  await page.mouse.click(dot1ClickX, dot1ClickY)
  await expect(page).toHaveURL(/\/historie\/[A-Za-z0-9_-]+$/, { timeout: 8_000 })
})

test('trends: multi-series Leistung + Effizienz card render', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  // Two-shape seed: 500 m × 4 (primary) + 2 k × 3 (secondary). Both clear
  // SERIES_THRESHOLD=3. Verifies the chart renders two series on Leistung
  // and that the Effizienz card mirrors the most-rowed shape with DPS + SPI
  // metric rows and no drawn rolling-avg overlay (rollingFor="none").
  //
  // Does NOT exercise drag/tap (covered by the test above). Interaction +
  // structural concerns are separated so a flake in one doesn't mask the
  // other.
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  const ids500 = seedTrendsSessions(handle.dbPath, rower.id, 500, 4, 16)
  const ids2k = seedTrendsSessions(handle.dbPath, rower.id, 2000, 3, 13)
  expect(ids500).toHaveLength(4)
  expect(ids2k).toHaveLength(3)

  await page.goto('/historie/trends?range=month')

  // Card sections wrap the charts. Scope by aria-label so the same testids
  // (trends-strip-row-*, trends-chart-capture, trends-chart-rolling) don't
  // collide between Leistung and Effizienz.
  const leistung = page.getByRole('region', { name: 'Leistung' })
  const effizienz = page.getByRole('region', { name: 'Effizienz' })

  await expect(leistung.getByTestId('trends-chart-capture')).toBeVisible({
    timeout: 15_000,
  })

  // --- Multi-series Leistung ---
  // shape_hash values are the canonical-params strings we seeded.
  await expect(
    leistung.getByTestId('trends-strip-row-{"meters":500}'),
  ).toBeVisible()
  await expect(
    leistung.getByTestId('trends-strip-row-{"meters":2000}'),
  ).toBeVisible()
  // 4 dots from 500m + 3 dots from 2k = 7 total on the Leistung chart.
  await expect(leistung.getByTestId('trends-chart-dot')).toHaveCount(7)
  // Rolling-avg overlay applies only to the primary series → exactly 1 path.
  await expect(leistung.getByTestId('trends-chart-rolling')).toHaveCount(1)

  // --- Effizienz card ---
  // Effizienz takes the most-rowed shape and renders DPS + SPI as two
  // metric "series" on shared y. Testids: `{shape_hash}-dps` / `-spi`.
  // No rolling-avg path drawn (rollingFor="none").
  await expect(effizienz.getByTestId('trends-chart-capture')).toBeVisible()
  await expect(
    effizienz.getByTestId('trends-strip-row-{"meters":500}-dps'),
  ).toBeVisible()
  await expect(
    effizienz.getByTestId('trends-strip-row-{"meters":500}-spi'),
  ).toBeVisible()
  await expect(effizienz.getByTestId('trends-chart-rolling')).toHaveCount(0)
  // Effizienz uses only the primary shape's points (4 dots) × 2 metrics = 8.
  await expect(effizienz.getByTestId('trends-chart-dot')).toHaveCount(8)
})
