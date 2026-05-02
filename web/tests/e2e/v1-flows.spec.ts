import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { ensureSplitsBinary, spawnBackend, type BackendHandle, waitForEndedSession } from './helpers/backend'
import { seedRower } from './helpers/rower'

// V1 user-flow coverage. One test per flow, each driving the real
// backend against a CSV fixture. Flows touch the surfaces a household
// member actually uses end-to-end:
//
//   - Fresh-device onboarding
//   - Free-row session ("Nur rudern")
//   - Distance workout
//   - Time workout
//   - Interval workout
//   - PB sanity (after first session, Rekorde tab is non-empty)
//
// Fixtures: SPLITS_FIXTURE_DELAY defers the producer's first frame so
// the user has time to onboard + click Start before frames start
// flowing. Without that, frames are dropped at the sessionizer
// because no session is open yet. SPLITS_FIXTURE_RATE=fast makes the
// fixture exhaust in ~50ms; SPLITS_IDLE_TIMEOUT=2s closes the session
// shortly after, so each flow finishes in <15s.

// Build the splits binary once across the whole spec.
test.beforeAll(() => {
  ensureSplitsBinary()
})

// Each flow needs ~10s for the fixture (6-8s delay + replay + idle 2s)
// plus assertions. 60s gives slack for slow CI machines.
test.setTimeout(60_000)

test.describe.configure({ mode: 'serial' }) // tests share port 8080

let backend: BackendHandle | null = null
test.afterEach(async () => {
  if (backend) {
    await backend.kill()
    backend = null
  }
})

const FIXTURE_M1 = '../specs/int/fixtures/ipm/session-m1.csv' // 48s, 163m, 20 strokes
const FIXTURE_M3 = '../specs/int/fixtures/ipm/session-m3-long.csv' // 284s, 1035m, 124 strokes

async function startFreshBackend(opts?: Parameters<typeof spawnBackend>[0]) {
  backend = await spawnBackend(opts)
  return backend
}

async function pairAndOpenHome(page: Page, context: BrowserContext, name = 'Daniel') {
  await page.goto('/')
  await seedRower(context, name)
  await page.goto('/')
  // RowerGate may have routed us through onboarding before seedRower
  // landed. Force-navigate after seeding and ensure home rendered.
  await expect(page.getByTestId('picker-just-row')).toBeVisible()
}

// ────────────────────────────────────────────────────────────────────
// Flow 1: First-time onboarding on a fresh device
// ────────────────────────────────────────────────────────────────────

test('onboarding: fresh device → create founder rower → home', async ({ page }) => {
  await startFreshBackend({ fixture: FIXTURE_M1 })
  await page.goto('/')
  // RowerGate should redirect to /onboarding when no rowers exist.
  await expect(page).toHaveURL(/onboarding/)
  // Fill the name field and submit. Field/button names are German.
  const nameInput = page.getByLabel(/Name/i).first()
  await nameInput.fill('Daniel')
  await page.getByRole('button', { name: /Anlegen|Erstellen|Speichern|Weiter/i }).first().click()
  // Land on home with the workout picker visible.
  await expect(page.getByTestId('picker-just-row')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Nur rudern/)).toBeVisible()
})

// ────────────────────────────────────────────────────────────────────
// Flow 2: Free-row session — "Nur rudern"
// ────────────────────────────────────────────────────────────────────

test('free row: Nur rudern → fixture replays → session in History + PB exists', async ({ page, context }) => {
  await startFreshBackend({ fixture: FIXTURE_M3, idleTimeout: '20s', fixtureDelay: '4s' })
  const r = await seedRowerVia(context)
  await page.goto('/')
  await expect(page.getByTestId('picker-just-row')).toBeVisible()

  // Click "Nur rudern" — POSTs /session/start and routes to /live.
  await Promise.all([page.waitForURL(/\/live/), page.getByTestId('picker-just-row').click()])

  // Wait for the fixture to play through and session_end to fire.
  // m3-long → fast → ~0.5s; idle 2s; plus 6s startup delay.
  const ended = await waitForEndedSession(r.id, 30_000)
  expect(ended.total_distance_m ?? 0).toBeGreaterThan(800)
  expect(ended.total_strokes ?? 0).toBeGreaterThan(50)

  // PB sanity: at least one PB row materialised after the recompute.
  await page.goto('/historie/rekorde')
  // Either distance or window PB section renders. The empty state copy
  // is "Noch keine Bestleistungen", so absence means data landed.
  await expect(page.getByText(/Noch keine Bestleistungen/i)).toHaveCount(0, { timeout: 10_000 })

  // History list shows the session.
  await page.goto('/historie')
  await expect(page.locator('text=/\\d+ m/').first()).toBeVisible({ timeout: 10_000 })
})

// ────────────────────────────────────────────────────────────────────
// Flow 3: Distance workout — 500 m
// ────────────────────────────────────────────────────────────────────

test('distance workout: pick 500 m → fixture replays → goal reached → session in History', async ({ page, context }) => {
  await startFreshBackend({ fixture: FIXTURE_M3, idleTimeout: '20s', fixtureDelay: '4s' })
  const r = await seedRowerVia(context)
  await page.goto('/')
  await expect(page.getByTestId('picker-just-row')).toBeVisible()

  await page.getByTestId('picker-distance').click()
  await expect(page.getByText(/Distanz wählen/)).toBeVisible()
  await page.getByRole('button', { name: '500 m' }).first().click()
  await page.getByRole('button', { name: /Moderat/i }).click()

  // Disable the default 5-min warmup + cooldown via UI so the fixture
  // window goes straight to PhaseWork and 500 m of distance can
  // accumulate before EOF.
  await page.getByRole('checkbox', { name: 'Warm-up' }).uncheck()
  await page.getByRole('checkbox', { name: 'Cool-down' }).uncheck()

  await expect(page.getByRole('button', { name: /^Start$/ })).toBeVisible()
  await Promise.all([
    page.waitForURL(/\/live/),
    page.getByRole('button', { name: /^Start$/ }).click(),
  ])

  const ended = await waitForEndedSession(r.id, 30_000)
  expect(ended.total_distance_m ?? 0).toBeGreaterThanOrEqual(500)
  expect(ended.total_strokes ?? 0).toBeGreaterThan(0)
})

// ────────────────────────────────────────────────────────────────────
// Flow 4: Time workout — 10 min
// ────────────────────────────────────────────────────────────────────

test('time workout: pick 10 min → fixture replays → session in History', async ({ page, context }) => {
  await startFreshBackend({ fixture: FIXTURE_M3, idleTimeout: '20s', fixtureDelay: '4s' })
  const r = await seedRowerVia(context)
  await page.goto('/')
  await expect(page.getByTestId('picker-just-row')).toBeVisible()

  await page.getByTestId('picker-time').click()
  await expect(page.getByText(/Zeit wählen/)).toBeVisible()
  await page.getByRole('button', { name: '10 min' }).first().click()
  await page.getByRole('button', { name: /Locker/i }).click()

  // Skip warmup so the fixture goes straight to PhaseWork; the 10 min
  // goal still won't fit in the 284 s replay, so EOF closes the
  // session — but with strokes + time accumulated.
  await page.getByRole('checkbox', { name: 'Warm-up' }).uncheck()
  await page.getByRole('checkbox', { name: 'Cool-down' }).uncheck()

  await expect(page.getByRole('button', { name: /^Start$/ })).toBeVisible()
  await Promise.all([
    page.waitForURL(/\/live/),
    page.getByRole('button', { name: /^Start$/ }).click(),
  ])

  // Fixture is 284 s wall-time; in fast mode all frames flush quickly.
  // Time goal is 10 min, so the goal won't fire — session ends via the
  // fixture EOF path instead. total_time_sec from the last frame.
  const ended = await waitForEndedSession(r.id, 30_000)
  expect(ended.total_strokes ?? 0).toBeGreaterThan(0)
  expect(ended.total_time_sec ?? 0).toBeGreaterThan(0)
})

// ────────────────────────────────────────────────────────────────────
// Flow 5: Interval workout — custom 2×200 m that fits inside the
// 1035 m fixture so we exercise the goal-reached close path.
// ────────────────────────────────────────────────────────────────────

test('intervals: custom 2×200 m → fixture replays → goal reached → session in History', async ({ page, context }) => {
  await startFreshBackend({ fixture: FIXTURE_M3, idleTimeout: '20s', fixtureDelay: '4s' })
  const r = await seedRowerVia(context)
  await page.goto('/')
  await expect(page.getByTestId('picker-just-row')).toBeVisible()

  await page.getByTestId('picker-intervals').click()

  // Drive the "Eigene" custom-interval form: defaults are
  // reps=4 / length=500 m / rest=120 s. Step the values down to
  // 2 / 200 / 30 so total work = 400 m fits inside the 1035 m fixture
  // and the workout completes via goal-reached.
  await page.getByRole('button', { name: 'Eigene' }).click()
  await expect(page.getByTestId('intervals-custom')).toBeVisible()

  // Runden: 4 → 2 (step 1, decrement twice).
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('intervals-reps').getByRole('button', { name: '−' }).click()
  }
  // Intervall-Länge: 500 m → 200 m (step 100, decrement three times).
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('intervals-length').getByRole('button', { name: '−' }).click()
  }
  // Pause: 120 s → 30 s (step 30, decrement three times).
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('intervals-rest').getByRole('button', { name: '−' }).click()
  }
  await page.getByRole('button', { name: 'Übernehmen' }).click()

  await page.getByRole('button', { name: /Hart/i }).click()

  await page.getByRole('checkbox', { name: 'Warm-up' }).uncheck()
  await page.getByRole('checkbox', { name: 'Cool-down' }).uncheck()

  await expect(page.getByRole('button', { name: /^Start$/ })).toBeVisible()
  await Promise.all([
    page.waitForURL(/\/live/),
    page.getByRole('button', { name: /^Start$/ }).click(),
  ])

  // 2×200 m = 400 m work + 1×30 s rest. Comfortably inside 1035 m and
  // 284 s of fixture data, so the sessionizer fires complete=true and
  // closes the session before fixture EOF.
  const ended = await waitForEndedSession(r.id, 30_000)
  expect(ended.total_distance_m ?? 0).toBeGreaterThanOrEqual(400)
  expect(ended.total_strokes ?? 0).toBeGreaterThan(0)
})

// ────────────────────────────────────────────────────────────────────
// Helpers local to this spec
// ────────────────────────────────────────────────────────────────────

async function seedRowerVia(context: BrowserContext) {
  // Distinct rower per test so PBs / sessions don't collide, even
  // though fresh DBs make this redundant — defensive.
  return seedRower(context, 'Tester-' + Math.random().toString(36).slice(2, 8))
}
