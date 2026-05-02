import { test, expect } from './fixtures'

// V1 user-flow coverage. One test per real interaction the household
// member walks through. Page objects keep the bodies declarative —
// each test reads as the user-visible script, not the DOM mechanics.
//
// Fixtures: SPLITS_FIXTURE_DELAY defers the producer's first frame
// so the test's onboarding + click "Start" finishes BEFORE frames
// begin flowing. Without that delay every frame would be dropped at
// the sessionizer because no session is open yet. Fast pacing
// flushes the fixture in milliseconds; idle 20 s prevents a stale-
// open close before frames arrive.

const FIXTURE_M3 = '../specs/int/fixtures/ipm/session-m3-long.csv'

test.describe.configure({ mode: 'serial' }) // tests share port 8080
test.setTimeout(60_000)

// ────────────────────────────────────────────────────────────────────
// Flow 1 — first-time onboarding on a fresh device
// ────────────────────────────────────────────────────────────────────

test('onboarding: fresh device → create founder rower → home', async ({
  startBackend,
  page,
  onboarding,
  home,
}) => {
  await startBackend({ fixture: FIXTURE_M3 })

  await page.goto('/')
  await onboarding.expectVisible()
  await onboarding.createRower('Daniel')

  await home.expectVisible()
  await expect(page.getByText(/Nur rudern/)).toBeVisible()
})

// ────────────────────────────────────────────────────────────────────
// Flow 2 — free-row session; verifies session lifecycle + PB sanity
// ────────────────────────────────────────────────────────────────────

test('free row: Nur rudern → fixture replays → session in History + PB exists', async ({
  startBackend,
  seedActiveRower,
  home,
  history,
  waitForEndedSession,
}) => {
  await startBackend({ fixture: FIXTURE_M3, idleTimeout: '20s', fixtureDelay: '4s' })
  const rower = await seedActiveRower()

  await home.open()
  await home.startFreeRow()

  const ended = await waitForEndedSession(rower.id, 30_000)
  expect(ended.total_distance_m ?? 0).toBeGreaterThan(800)
  expect(ended.total_strokes ?? 0).toBeGreaterThan(50)

  await history.openRekorde()
  await history.expectAtLeastOnePB()
  await history.openSessions()
  await history.expectAtLeastOneSession()
})

// ────────────────────────────────────────────────────────────────────
// Flow 3 — distance workout (500 m, goal-reached close)
// ────────────────────────────────────────────────────────────────────

test('distance workout: pick 500 m → fixture replays → goal reached → session in History', async ({
  startBackend,
  seedActiveRower,
  home,
  workoutFlow,
  waitForEndedSession,
}) => {
  await startBackend({ fixture: FIXTURE_M3, idleTimeout: '20s', fixtureDelay: '4s' })
  const rower = await seedActiveRower()

  await home.open()
  await home.pickDistance()
  await workoutFlow.expectDistanceStep()
  await workoutFlow.pickDistancePreset('500 m')
  await workoutFlow.pickIntensity('Moderat')
  await workoutFlow.skipWarmupAndCooldown()
  await workoutFlow.expectConfirmReady()
  await workoutFlow.start()

  const ended = await waitForEndedSession(rower.id, 30_000)
  expect(ended.total_distance_m ?? 0).toBeGreaterThanOrEqual(500)
  expect(ended.total_strokes ?? 0).toBeGreaterThan(0)
})

// ────────────────────────────────────────────────────────────────────
// Flow 4 — time workout (10 min; fixture EOF closes session)
// ────────────────────────────────────────────────────────────────────

test('time workout: pick 10 min → fixture replays → session in History', async ({
  startBackend,
  seedActiveRower,
  home,
  workoutFlow,
  waitForEndedSession,
}) => {
  await startBackend({ fixture: FIXTURE_M3, idleTimeout: '20s', fixtureDelay: '4s' })
  const rower = await seedActiveRower()

  await home.open()
  await home.pickTime()
  await workoutFlow.expectTimeStep()
  await workoutFlow.pickTimePreset('10 min')
  await workoutFlow.pickIntensity('Locker')
  await workoutFlow.skipWarmupAndCooldown()
  await workoutFlow.expectConfirmReady()
  await workoutFlow.start()

  // 10 min goal can't fit in 284 s of fixture data; session ends on
  // EOF with strokes + time accumulated.
  const ended = await waitForEndedSession(rower.id, 30_000)
  expect(ended.total_strokes ?? 0).toBeGreaterThan(0)
  expect(ended.total_time_sec ?? 0).toBeGreaterThan(0)
})

// ────────────────────────────────────────────────────────────────────
// Flow 5 — custom 2×200 m intervals (fits in 1035 m fixture)
// ────────────────────────────────────────────────────────────────────

test('intervals: custom 2×200 m → fixture replays → goal reached → session in History', async ({
  startBackend,
  seedActiveRower,
  home,
  workoutFlow,
  waitForEndedSession,
}) => {
  await startBackend({ fixture: FIXTURE_M3, idleTimeout: '20s', fixtureDelay: '4s' })
  const rower = await seedActiveRower()

  await home.open()
  await home.pickIntervals()
  await workoutFlow.customIntervals({ reps: 2, lengthM: 200, restSec: 30 })
  await workoutFlow.pickIntensity('Hart')
  await workoutFlow.skipWarmupAndCooldown()
  await workoutFlow.expectConfirmReady()
  await workoutFlow.start()

  // 2×200 m = 400 m work + 30 s rest. Comfortably inside 1035 m and
  // 284 s of fixture data, so complete=true closes the session.
  const ended = await waitForEndedSession(rower.id, 30_000)
  expect(ended.total_distance_m ?? 0).toBeGreaterThanOrEqual(400)
  expect(ended.total_strokes ?? 0).toBeGreaterThan(0)
})
