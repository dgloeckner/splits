import { test, expect } from './fixtures'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFixtureStats } from './helpers/fixtureStats'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = '../specs/int/fixtures/ipm/session-short.csv'
const FIXTURE_ABS = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'specs/int/fixtures/ipm/session-short.csv',
)

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test('history detail: hero numerics + chart paths match the fixture', async ({
  startBackend,
  seedActiveRower,
  home,
  history,
  waitForEndedSession,
}) => {
  // Fast pacing flushes the fixture in ms; idle 2 s closes the session
  // soon after EOF. fixtureDelay defers playback so the UI can start
  // the session via the "Nur rudern" button before any frames flow.
  await startBackend({
    fixture: FIXTURE,
    fixtureRate: 'fast',
    idleTimeout: '5s',
    fixtureDelay: '4s',
  })
  const rower = await seedActiveRower()
  const fx = loadFixtureStats(FIXTURE_ABS)

  await home.open()
  await home.startFreeRow()

  // Wait for backend to close the session (fixture EOF + 2 s idle).
  const ended = await waitForEndedSession(rower.id, 30_000)
  // Backend's total_distance_m = distance covered during strokes
  // (last active frame minus first stroke frame), not the absolute
  // odometer reading.
  expect(ended.total_distance_m ?? 0).toBeGreaterThanOrEqual(fx.distanceCoveredM - 15)
  expect(ended.total_distance_m ?? 0).toBeLessThanOrEqual(fx.distanceCoveredM + 15)

  await history.openSessions()
  await history.expectFirstSessionDistanceNear(fx)
  await history.openFirstSession()
  await history.expectDetailMatchesFixture(fx)
})
