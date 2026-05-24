import { test } from './fixtures'
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

test.describe.configure({ mode: 'serial' }) // shares port 8080
test.setTimeout(60_000)

test('live view: hero metrics match the fixture within EMA tolerances', async ({
  startBackend,
  seedActiveRower,
  home,
  live,
}) => {
  // realtime pacing: frames flow over the fixture's wall-clock span
  // (≈58 s active). The test asserts mid-stream so dead-reckoning,
  // smoothing, and pause-blanking aren't all racing the assertions.
  // 60 s idle keeps the session open through the full read window.
  await startBackend({
    fixture: FIXTURE,
    fixtureRate: 'realtime',
    idleTimeout: '60s',
    fixtureDelay: '4s',
  })
  await seedActiveRower()

  const fx = loadFixtureStats(FIXTURE_ABS)

  await home.open()
  await home.startFreeRow()

  // Wait past the device's warmup-period transients before asserting.
  // The IPM ships its first frame with a sentinel split-pace (10:45
  // /500 m on this fixture) until it has enough data to compute a
  // real value. Holding for ~50 m of distance guarantees several
  // strokes have arrived; the helper also asserts no hero metric is
  // "—", which is the regression we're guarding against (a missing
  // wire field renders as a perpetual em-dash even when the rest of
  // the row is fine).
  await live.waitForHeroSettled(50, 30_000)
  await live.expectHeroMatchesFixture(fx)
})
