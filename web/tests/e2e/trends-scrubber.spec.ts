import { test, expect } from './fixtures'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

/**
 * Seed 3 completed distance-500m sessions directly via SQLite so the
 * Trends endpoint has enough data to cross the SERIES_THRESHOLD (≥3) and
 * render a TrendsChart. This bypasses the need to replay a fixture three
 * times, keeping the test fast and deterministic.
 *
 * Shape hash format matches what the backend computes for a 500 m
 * distance workout (see backend/internal/api/trends_test.go).
 */
function seedTrendsSessions(dbPath: string, rowerId: string): string[] {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const sessionIds: string[] = []

  const rows: Array<{
    sessionId: string
    workoutId: string
    startedAt: string
    endedAt: string
  }> = []

  for (let i = 0; i < 3; i++) {
    const sessionId = randomUUID()
    const workoutId = randomUUID()
    const start = new Date(now - (15 - i * 5) * day).toISOString()
    const end = new Date(now - (15 - i * 5) * day + 10 * 60 * 1000).toISOString()
    rows.push({ sessionId, workoutId, startedAt: start, endedAt: end })
    sessionIds.push(sessionId)
  }

  // Insert workouts first (FK source for sessions.workout_id)
  const workoutInserts = rows
    .map(
      (r) =>
        `INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
         VALUES('${r.workoutId}', 'distance', '{"meters":500}', 'moderat', 0, 0,
                '${r.startedAt}', '{"meters":500}');`,
    )
    .join('\n')

  // Insert sessions with realistic aggregate metrics
  const sessionInserts = rows
    .map(
      (r, i) =>
        `INSERT INTO sessions(id, rower_id, started_at, ended_at, initial_level,
              total_distance_m, total_time_sec, total_strokes,
              avg_power_w, avg_pace_sec_per_500m, avg_dps, avg_spi, avg_spm,
              workout_id)
         VALUES('${r.sessionId}', '${rowerId}', '${r.startedAt}', '${r.endedAt}',
                3, 500, ${550 - i * 10}, 100,
                ${160 + i * 5}, ${130 - i * 2}, ${8.5 + i * 0.2}, ${7.0 + i * 0.1}, 24.0,
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
  // No fixture needed — we seed sessions directly via SQLite.
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()

  // Seed 3 completed 500m sessions so SERIES_THRESHOLD (≥3) is met.
  const sessionIds = seedTrendsSessions(handle.dbPath, rower.id)
  expect(sessionIds).toHaveLength(3)

  // Navigate to Trends tab with month range (covers sessions up to 15 days ago).
  await page.goto('/historie/trends?range=month')

  // Wait for at least one TrendsChart capture rect to appear.
  // If the series threshold is not met the capture rect won't render.
  await expect(page.getByTestId('trends-chart-capture').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId('trends-strip-date').first()).toBeVisible()

  // Capture the idle strip text from the first strip row (primary series).
  const firstStripRow = page.getByTestId(/^trends-strip-row-/).first()
  const idleText = (await firstStripRow.textContent()) ?? ''

  // --- Scrub test ---
  // Pointer events fire from mouse drags and the chart's useChartScrubber
  // treats them identically per ADR-0016 (PointerEvents only, no hover).
  const capture = page.getByTestId('trends-chart-capture').first()
  const box = await capture.boundingBox()
  if (!box) throw new Error('trends-chart-capture bounding box missing')

  // Drag strategy: start near the RIGHT edge (most-recent / idle point) then
  // move to the LEFT edge (oldest point). Once the cursor has moved ≥10 px
  // (DRAG_THRESHOLD_PX), the hook enters scrubbing mode and snaps scrubX to
  // the nearest dot — here the leftmost (oldest) dot. Sampling the strip at
  // that point must differ from idle (the rightmost / newest point).
  const midY = box.y + box.height / 2
  // Start near right edge.
  await page.mouse.move(box.x + box.width - 5, midY)
  await page.mouse.down()
  // Move all the way to the left. After >10 px of horizontal travel the
  // hook enters scrubbing mode and snaps to the leftmost dot.
  await page.mouse.move(box.x + 5, midY, { steps: 15 })
  // Wait a render tick so React state update flushes to the DOM.
  await page.waitForTimeout(100)
  const scrubbedText = (await firstStripRow.textContent()) ?? ''
  await page.mouse.up()

  // The strip at the left edge (oldest point, pace 2:10) should differ from
  // the idle strip (newest point, pace 2:06).
  expect(scrubbedText).not.toBe(idleText)

  // Wait for the 3 s post-release hold to expire so scrubX resets to null,
  // returning the strip to idle state before the dot-tap test.
  await page.waitForTimeout(3_500)

  // --- Dot-tap test ---
  // The useChartScrubber hook compares localX (= clientX - captureRect.left)
  // against dots[i].x (viewBox coordinates from toX(), range PLOT_LEFT..PLOT_RIGHT).
  // To trigger findDotNear, we must click at clientX = captureRect.left + dot.x.
  // For the first dot: dot.x = PLOT_LEFT = 34 (viewBox units; the xMin point).
  // The capture rect starts at viewBox x=PLOT_LEFT in screen-space. Clicking at
  // captureRect.left + 34 gives localX=34 which matches dot0.x=34.
  //
  // Middle dot (dot1, fraction=0.5): dot.x = PLOT_LEFT + 0.5*PLOT_W = 34+131 = 165.
  // Clicking at captureRect.left + 165 is a more central target with more tolerance.
  const captureForTap = page.getByTestId('trends-chart-capture').first()
  const captureForTapBox = await captureForTap.boundingBox()
  if (!captureForTapBox) throw new Error('capture bounding box missing for tap test')

  // Click targeting dot1 (middle dot, localX=165). The middle dot is mid-range
  // so it is unambiguously closer to x=165 than to x=34 or x=296.
  const PLOT_LEFT_VB = 34
  const PLOT_W_VB = 262 // PLOT_RIGHT (296) - PLOT_LEFT (34)
  const dot1ViewBoxX = PLOT_LEFT_VB + 0.5 * PLOT_W_VB // = 165
  const dot1ClickX = captureForTapBox.x + dot1ViewBoxX
  const dot1ClickY = captureForTapBox.y + captureForTapBox.height / 2

  await page.mouse.click(dot1ClickX, dot1ClickY)

  // onDotTap calls navigate(`/historie/${sessionId}`).
  await expect(page).toHaveURL(/\/historie\/[A-Za-z0-9_-]+$/, { timeout: 8_000 })
})
