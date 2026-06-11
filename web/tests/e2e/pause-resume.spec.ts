import { test, expect } from './fixtures'
import { pauseFixture, resumeFixture } from './helpers/backend'

/**
 * ADR-0014 Phase D gate — pause / auto-resume (phone-call scenario).
 *
 * A rower gets a phone call mid-workout. The ergo stops sending new
 * distance values. After PauseTimeout the sessionizer enters the Paused
 * sub-state and broadcasts a `session_paused` event; the UI shows the
 * "Pausiert" chip. When the rower returns and rows again the session
 * auto-resumes without disruption: the chip disappears, distance keeps
 * climbing, and the final `total_time_sec` excludes the pause gap.
 *
 * A second (negative) case verifies that a pause lasting longer than
 * ResumeWindow force-closes the session and shows the ended overlay.
 *
 * Implementation note on pacing
 * ──────────────────────────────
 * We use `fixtureRate: 'fast'` with a short `fixtureDelay` so strokes
 * arrive quickly after the user clicks Start. Then we call
 * `pauseFixture()` to stop the fixture replayer mid-stream. Because the
 * sessionizer's idle-detection fires when *distance stops advancing*
 * (not when frames stop arriving), the FixtureProducer mid-stream pause
 * causes exactly the same effect as the ergo going silent.
 *
 * Timeouts chosen for a fast CI run:
 *   PauseTimeout  = 3 s  (default 10 s)
 *   ResumeWindow  = 15 s (default 15 m) for the negative case
 */

const FIXTURE = '../specs/int/fixtures/ipm/session-m3-long.csv'

// Serial: both cases start/kill a backend on a dynamically-assigned
// port but share the same Vite worker, so running them sequentially
// avoids any port-race between the two backends.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test.describe('pause / auto-resume (ADR-0014 Phase D)', () => {
  // ──────────────────────────────────────────────────────────────────
  // Happy path — phone call → Pausiert chip → resume → session intact
  // ──────────────────────────────────────────────────────────────────
  test('mid-work pause shows Pausiert chip; auto-resumes when fixture restarts', async ({
    startBackend,
    seedActiveRower,
    home,
    live,
    viteWorker,
    context,
    page,
  }) => {
    // Start the fixture in a paused state so we control exactly when
    // frames begin to flow. We seed the rower + click Start first,
    // then release the fixture. This avoids the race where "fast" mode
    // flushes the entire fixture before the session is even open.
    const backend = await startBackend({
      fixture: FIXTURE,
      fixtureRate: 'realtime',
      fixturePaused: true,
      // Short thresholds so the test completes quickly.
      pauseTimeout: '3s',
      resumeWindow: '60s',
      idleTimeout: '120s',
      addr: `127.0.0.1:${viteWorker.backendPort}`,
    })

    await seedActiveRower()

    await home.open()
    await home.startFreeRow()

    // Release the fixture now that the session is open and the browser
    // is subscribed to the SSE stream.
    await resumeFixture(backend)

    // Wait until at least 50 m so the hero has settled past warmup and
    // the session has real strokes before we interrupt it.
    // At realtime pacing, session-m3-long reaches 50 m in ≈14 s.
    await live.waitForHeroSettled(50, 60_000)

    // Capture the current hero distance so we can assert it hasn't
    // reset to 0 after resume.
    const distBeforePauseText =
      (await page.getByTestId('hero-distanz-value').textContent())?.trim() ?? '0'
    const distBeforePause = Number(distBeforePauseText)
    expect(distBeforePause).toBeGreaterThan(0)

    // --- PAUSE: simulate the phone call by stopping the fixture ---
    await pauseFixture(backend)

    // After PauseTimeout (3 s), the sessionizer emits session_paused
    // and the UI shows the "Pausiert" chip. Add a small buffer above
    // the 3 s threshold to absorb network latency between the backend
    // and the SSE client.
    await expect(page.getByTestId('paused-chip')).toBeVisible({ timeout: 10_000 })

    // The session-ended overlay must NOT be visible during a normal pause.
    await expect(page.getByTestId('session-ended-overlay')).not.toBeVisible()

    // --- RESUME: restart the fixture ---
    await resumeFixture(backend)

    // The chip should disappear once the first new stroke arrives.
    await expect(page.getByTestId('paused-chip')).not.toBeVisible({ timeout: 15_000 })

    // Distance must continue climbing (not reset to 0).
    await expect
      .poll(
        async () => {
          const txt = (
            await page.getByTestId('hero-distanz-value').textContent()
          )?.trim()
          return Number(txt)
        },
        { timeout: 20_000, message: 'distance should climb past pre-pause value after resume' },
      )
      .toBeGreaterThan(distBeforePause)

    // Explicitly end the session so the backend shuts down cleanly;
    // at realtime pacing the fixture would take minutes to exhaust.
    await context.request.post('/api/v1/session/end')
  })

  // ──────────────────────────────────────────────────────────────────
  // Negative path — pause exceeds ResumeWindow → session force-closed
  // ──────────────────────────────────────────────────────────────────
  test('pause exceeding ResumeWindow shows session-ended overlay', async ({
    startBackend,
    seedActiveRower,
    home,
    live,
    viteWorker,
    page,
  }) => {
    const backend = await startBackend({
      fixture: FIXTURE,
      fixtureRate: 'realtime',
      fixturePaused: true,
      pauseTimeout: '3s',
      // Short ResumeWindow so the test doesn't have to wait long.
      resumeWindow: '8s',
      // IdleTimeout must be longer than ResumeWindow so the sessionizer
      // doesn't close via the legacy idle path before the pause path fires.
      idleTimeout: '120s',
      addr: `127.0.0.1:${viteWorker.backendPort}`,
    })

    await seedActiveRower()

    await home.open()
    await home.startFreeRow()

    // Release the fixture once the session is open.
    await resumeFixture(backend)

    // Wait past warmup so there are real strokes before we interrupt.
    await live.waitForHeroSettled(30, 60_000)

    // Stop the fixture — no more distance advances.
    // We do NOT resume in this test; the pause outlasts ResumeWindow.
    await pauseFixture(backend)

    // After PauseTimeout (3 s) the chip appears.
    await expect(page.getByTestId('paused-chip')).toBeVisible({ timeout: 10_000 })

    // After ResumeWindow (8 s more) the session is force-closed and the
    // ended overlay should appear. Allow up to 30 s total from the
    // pause call above (PauseTimeout + ResumeWindow + SSE latency).
    await expect(page.getByTestId('session-ended-overlay')).toBeVisible({ timeout: 30_000 })
  })
})
