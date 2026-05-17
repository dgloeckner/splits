// UX/visual audit — race flow capture.
//
// Drives the race-mode flow through the full surface — static wizard
// states, the start ceremony, the live canvas, and both edge flows
// (Falschstart, Abort) — capturing screenshots at two viewports.
// Every capture also writes a `.layout.json` sidecar so the critique
// pass reads PNG + JSON together.
//
// Canonical heuristic checklist: docs/ux-audit-heuristics.md.
// Sibling pilot: distance-capture.spec.ts.
//
// Captures land in test-results/ux-audit/race/<viewport>/<state>.{png,layout.json}.
// This spec is intentionally assertion-light — its job is to PRODUCE
// EVIDENCE for the critique pass, not to fail on its own findings.
//
// Five tests, mapped to distinct slices of the race surface:
//
//   1. static-flow      — Home / Step2 / Step3 / Übersicht ×3 opponent
//                         configs. Fresh rower; the Übersicht toggles
//                         render identically whether prior sessions
//                         exist or not, so the fresh path covers them.
//   2. live-fresh        — Bereit / Ceremony×3 / Live×3 / Finish / Post,
//                         with synth-ghost only (no PB; no session-
//                         ghost). The "first race ever" empty state.
//   3. live-seeded      — SKIPPED. Plan was: replay a full 500 m race
//                         to populate session-ghost + PB-leader, then
//                         start a second race for canvas/finish/post
//                         captures. Implementation requires bouncing
//                         the backend mid-test (fixture replay is
//                         single-shot per backend run); the browser
//                         page doesn't recover cleanly from the
//                         bounce. Revisit once a /test/seed-session
//                         dev-mode endpoint lands — that lets us seed
//                         a closed session via REST without restart.
//   4. falschstart       — Resume the paused fixture during the SET
//                         window so a stroke arrives before GO!.
//                         Captures the Falschstart toast.
//   5. abort             — Tap the Abbrechen pill during Live, capture
//                         the confirm sheet open, confirm, capture the
//                         post-abort destination.

import { expect } from '@playwright/test'
import { test } from '../fixtures'
import { resumeFixture } from '../helpers/backend'
import { captureLayout } from './layout-audit'

const FIXTURE = '../specs/int/fixtures/ipm/session-m3-long.csv'

const PHONE = { width: 390, height: 844 } // iPhone-ish, mobile-first default
const TABLET = { width: 820, height: 1180 } // iPad-ish, landscape-adjacent

const VIEWPORTS = [
  { name: 'phone', size: PHONE },
  { name: 'tablet', size: TABLET },
]

// No describe.configure({ mode: 'serial' }) here: each test spawns its
// own backend on a dynamic port via the worker-scoped fixture, so a
// single test's failure shouldn't skip the rest. (Distance spec used
// serial — racing tests need the looser shape to iterate the live-
// pacing timing without re-running everything on each red.)

for (const v of VIEWPORTS) {
  test.describe(`race flow — ${v.name} (${v.size.width}x${v.size.height})`, () => {
    test.use({ viewport: v.size })

    // Each test owns its own setTimeout — live-seeded needs ~2 min for
    // the warm-up race; the others fit comfortably in 60 s.

    // ──────────────────────────────────────────────────────────────
    // Test 1 — static-flow. No frames flow. Captures Home + Step2 +
    // Step3 + Übersicht in all three opponent toggle configurations.
    // ──────────────────────────────────────────────────────────────
    test('capture: home, step2 race presets, step3 intensity, übersicht (both/ghost-only/neither)', async ({
      startBackend,
      seedActiveRower,
      page,
      home,
      raceFlow,
    }) => {
      test.setTimeout(60_000)

      // Long fixtureDelay keeps the producer silent — we capture UI
      // states only, no strokes during navigation.
      await startBackend({ fixture: FIXTURE, idleTimeout: '120s', fixtureDelay: '600s' })
      await seedActiveRower()

      const out = (state: string) => `../test-results/ux-audit/race/${v.name}/${state}.png`
      const snap = async (state: string) => {
        const path = out(state)
        await page.screenshot({ path, fullPage: true })
        await captureLayout(page, path)
      }

      // 1. Home — mode picker (Step 1).
      await home.open()
      await snap('01-home')

      // 2. Step 2 — race-distance presets (all 8: 500/1000/2000/5000/
      //    6000/10000/HM/Marathon). The chip grid is the most label-
      //    dense step in the app; F11-class wrap regressions land here.
      await raceFlow.gotoWorkoutFlow()
      await snap('02-step2-race-presets')

      // 3. Step 3 — intensity. Four buttons (Locker/Moderat/Hart/All-out)
      //    visible at once; verifies label survival and tap-target sizing.
      await raceFlow.pickDistance(500)
      await snap('03-step3-intensity')

      // 4. Übersicht — default state (both opponents on). This is what
      //    a returning rower sees if their last config left both toggles
      //    enabled. Ghost + PB checkboxes both checked.
      await raceFlow.pickIntensity('Moderat')
      await expect(page.getByRole('heading', { name: /Übersicht/i })).toBeVisible()
      await snap('04a-übersicht-both')

      // 5. Übersicht — ghost-only. Uncheck PB, snap. The "Intensität
      //    wirkt sich nicht aus." hint should NOT be visible (it only
      //    shows when ghost is off).
      await page.getByLabel(/Bestzeit/i).uncheck()
      await snap('04b-übersicht-ghost-only')

      // 6. Übersicht — neither. Uncheck ghost as well; the
      //    "Intensität wirkt sich nicht aus." hint SHOULD now appear.
      //    Captures the empty-opponent state — a Start tap from here
      //    is a "solo time trial" with no boats besides the user's.
      await page.getByLabel(/Synthetischer Geist/i).uncheck()
      await snap('04c-übersicht-neither')
    })

    // ──────────────────────────────────────────────────────────────
    // Test 2 — live happy path, fresh rower. Captures the dynamic
    // surface (Bereit, ceremony triple, live triple, finish, post)
    // with synth-ghost only — no session-ghost, no PB-leader. The
    // "first race ever" empty state for opponents.
    //
    // Uses fixturePaused + resumeFixture so the ceremony captures
    // happen with NO strokes contaminating the visual state, then
    // releases the fixture exactly at GO!.
    // ──────────────────────────────────────────────────────────────
    test('capture: bereit, ceremony attention/set/go, live early/mid/near-finish, finish, post (fresh)', async ({
      startBackend,
      seedActiveRower,
      page,
      raceFlow,
    }) => {
      test.setTimeout(300_000)

      // realtime pacing: with `fast` the entire fixture would fire in
      // <1 s after GO! and the three live captures (early/mid/near-
      // finish) would collapse into one frame. realtime honours the
      // capture_ts deltas, so the race takes ~145 s wall-clock to
      // cross 500 m (M3 long fixture) on phone. Tablet rendering adds
      // ~30 s of slack, so the test budget needs ≥ 285 s total
      // (5 s + 60 s + 60 s + 60 s finish-overlay wait + setup).
      const backend = await startBackend({
        fixture: FIXTURE,
        fixtureRate: 'realtime',
        fixtureDelay: '0s',
        fixturePaused: true,
        idleTimeout: '30s',
      })
      await seedActiveRower()

      const out = (state: string) => `../test-results/ux-audit/race/${v.name}/${state}.png`
      const snap = async (state: string) => {
        const path = out(state)
        await page.screenshot({ path, fullPage: true })
        await captureLayout(page, path)
      }

      await raceFlow.gotoWorkoutFlow()
      await raceFlow.pickDistance(500)
      await raceFlow.pickIntensity('Moderat')
      // Confirm with synth-ghost only — PB toggle off (no prior session
      // to seed it from anyway). Captures the fresh-rower opponent state.
      await raceFlow.confirmRace({ ghost: true, pb: false })

      // 5. Bereit — pre-ceremony "at the catch" screen.
      await expect(page.getByTestId('bereit-screen')).toBeVisible()
      await snap('05-bereit-fresh')
      await raceFlow.tapBereit()

      // 6. Ceremony ATTENTION. Canvas mounted; user boat parked at the
      //    start line. (Boat sprite may have zero bbox until the canvas
      //    ResizeObserver fires — see 0016-05 caveat. We assert
      //    canvas visibility, not boat geometry.)
      await raceFlow.waitForCeremonyStep('attention', 4_000)
      await expect(raceFlow.raceCanvas()).toBeVisible()
      await snap('06-ceremony-attention-fresh')

      // 7. Ceremony SET. 1500 ms after ATTENTION. Snap window is tight;
      //    if this slips past 1500 ms we end up capturing GO! — surface
      //    that as a follow-up rather than retrying silently.
      await raceFlow.waitForCeremonyStep('set', 3_000)
      await snap('07-ceremony-set-fresh')

      // 8. Ceremony GO! Then release the paused fixture so the first
      //    stroke arrives AFTER GO! — keeps race_t0 clean (no Falschstart).
      await raceFlow.waitForCeremonyStep('go', 3_000)
      await snap('08-ceremony-go-fresh')
      await resumeFixture(backend)

      // 9. Live — early race (~5 s after GO!). Boats clustered near
      //    the start line; spread is still small.
      await page.waitForTimeout(5_000)
      await snap('09-live-early-fresh')

      // 10. Live — mid race (~65 s after GO!). Spread has developed.
      //     For a 500 m race at M3 realtime pace this is roughly
      //     halfway.
      await page.waitForTimeout(60_000)
      await snap('10-live-mid-fresh')

      // 11. Live — near finish (~125 s after GO!). Boats compressed
      //     near the right edge. Finish horn imminent (~145 s).
      await page.waitForTimeout(60_000)
      await snap('11-live-near-finish-fresh')

      // 12. Finish overlay — latched final time + gaps. The overlay
      //     renders over the still-mounted canvas; canvas remains visible
      //     behind it. 60 s timeout leaves ~30 s headroom past expected
      //     finish.
      await raceFlow.waitForFinishOverlay(60_000)
      await snap('12-finish-fresh')

      // Post-screen snap intentionally skipped here: with realtime
      // pacing the fixture continues emitting frames for ~3 more
      // minutes past the 500 m finish, so session_end (30 s idle) only
      // fires once the fixture exhausts. The post-screen capture is
      // delegated to a dedicated fast-paced test if it becomes useful.
    })

    // ──────────────────────────────────────────────────────────────
    // Test 3 — live happy path, SEEDED. Run a full 500 m race to
    // completion first so the DB has a real ended session at this
    // distance; then start a second race so its canvas / finish
    // overlay / post screen show session-ghost + PB-leader.
    //
    // ~2 min total. Same capture shape as test 2 but suffixed
    // `-seeded`. Heuristic reviewer diffs the two passes to surface
    // any empty-state vs populated-state divergences.
    // ──────────────────────────────────────────────────────────────
    // TODO(seeded captures): this test runs a warm-up race, kills the
    // backend, restarts it pointing at the same DB, and opens a new
    // race so the canvas shows session-ghost + PB-leader. The pattern
    // works as far as the kill+restart, but the browser page (Vite SSE
    // + cached fetch state) does not recover cleanly when the backend
    // bounces under it — gotoWorkoutFlow then hangs on the home picker.
    // Skipped until a `/test/seed-session` dev-mode endpoint lands;
    // that endpoint sidesteps the bounce entirely (single backend,
    // inject a complete session via REST, capture against a populated
    // DB). See helpers/seedPriorRaceSession.ts "Known limitations".
    test.skip('capture: bereit, ceremony, live, finish, post (seeded — session-ghost + PB-leader populated)', async ({
      startBackend,
      seedActiveRower,
      page,
      raceFlow,
    }) => {
      test.setTimeout(480_000)

      // Warm-up race: idleTimeout short so the seeding session closes
      // promptly after strokes stop. Fast pacing on the warm-up — the
      // seeding race itself is uncaptured, we just need a finished
      // session in the DB. Fixture starts paused so we can line up
      // Bereit → resume → finish, then close.
      const backend = await startBackend({
        fixture: FIXTURE,
        fixtureRate: 'fast',
        fixtureDelay: '0s',
        fixturePaused: true,
        idleTimeout: '5s',
      })
      await seedActiveRower()

      const out = (state: string) => `../test-results/ux-audit/race/${v.name}/${state}.png`
      const snap = async (state: string) => {
        const path = out(state)
        await page.screenshot({ path, fullPage: true })
        await captureLayout(page, path)
      }

      // --- Warm-up race (uncaptured) -----------------------------------
      // Run 500 m to completion so a real ended session exists in the
      // DB. This populates session-ghost + PB-leader for the next race.
      await raceFlow.gotoWorkoutFlow()
      await raceFlow.pickDistance(500)
      await raceFlow.pickIntensity('Moderat')
      await raceFlow.confirmRace({ ghost: true, pb: false })
      await raceFlow.tapBereit()
      await raceFlow.waitForCeremonyStep('go', 6_000)
      await resumeFixture(backend)
      // Skip waitForFinishOverlay — at `fast` pacing the overlay
      // flashes and transitions to RacePostScreen before the assertion
      // can grab it. We only need the session ended in the DB to seed
      // the next race; PostScreen visibility is a sufficient proxy.
      await raceFlow.waitForPostScreen(30_000)
      // Idle timeout (5 s) fires session_end. Give it a beat.
      await page.waitForTimeout(7_000)

      // --- Under-test race (captured) ----------------------------------
      // Restart fixture replay for the second race. The backend's
      // fixture replayer needs a fresh resume after the previous race
      // closed; tests/0016-05 happy-path documents that the producer is
      // single-shot per backend run — so we restart the backend.
      // (This code does not run — see test.skip above. Kept as the
      // shape of the intended flow for when /test/seed-session lands.)
      await backend.kill()
      const backend2 = await startBackend({
        fixture: FIXTURE,
        fixtureRate: 'realtime',
        fixtureDelay: '0s',
        fixturePaused: true,
        idleTimeout: '30s',
      })

      await raceFlow.gotoWorkoutFlow()
      await raceFlow.pickDistance(500)
      await raceFlow.pickIntensity('Moderat')
      // Both opponents on — they have data to draw from now.
      await raceFlow.confirmRace({ ghost: true, pb: true })

      // 14a. PB overlay — the warm-up race produced a new PB; on
      //      LivePage mount for the second race the overlay surfaces
      //      *on top of* the Bereit screen. The banners hook resolves
      //      asynchronously after mount, so we explicitly wait up to
      //      5 s for the overlay before deciding whether to dismiss.
      //      This is a real user-facing state worth auditing (the
      //      rower has to acknowledge the PB before they can tap
      //      Bereit). Capture, then dismiss.
      const pbOverlay = page.getByTestId('pb-overlay')
      const overlayAppeared = await pbOverlay
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false)
      if (overlayAppeared) {
        await snap('14a-pb-overlay-from-warmup')
        // The overlay walks 1..N PB items; click "Weiter" until it
        // closes (single-item stack closes on the first click).
        for (let i = 0; i < 5; i++) {
          if (!(await pbOverlay.isVisible().catch(() => false))) break
          await page.getByRole('button', { name: /Weiter/i }).click()
          await pbOverlay
            .waitFor({ state: 'hidden', timeout: 1_000 })
            .catch(() => {})
        }
      }

      // 14. Bereit — seeded variant. Same screen as fresh; comparison
      //     should yield no divergence (we capture it anyway as the
      //     opening frame of the seeded series).
      await expect(page.getByTestId('bereit-screen')).toBeVisible()
      await snap('14-bereit-seeded')
      await raceFlow.tapBereit()

      // 15. Ceremony ATTENTION — seeded. Canvas shows three parked
      //     boats (user, session-ghost, PB-leader).
      await raceFlow.waitForCeremonyStep('attention', 4_000)
      await snap('15-ceremony-attention-seeded')

      // 16. Ceremony SET — seeded.
      await raceFlow.waitForCeremonyStep('set', 3_000)
      await snap('16-ceremony-set-seeded')

      // 17. Ceremony GO! — seeded.
      await raceFlow.waitForCeremonyStep('go', 3_000)
      await snap('17-ceremony-go-seeded')
      await resumeFixture(backend2)

      // 18. Live early — seeded. Three boats spreading from the start.
      await page.waitForTimeout(5_000)
      await snap('18-live-early-seeded')

      // 19. Live mid — seeded (~65 s post-GO!). Lane separation drives
      //     the most interesting layout — long-label gap chips may appear.
      await page.waitForTimeout(60_000)
      await snap('19-live-mid-seeded')

      // 20. Live near-finish — seeded (~125 s post-GO!).
      await page.waitForTimeout(60_000)
      await snap('20-live-near-finish-seeded')

      // 21. Finish overlay — seeded. Gap-to-ghost + gap-to-PB both shown.
      //     This is the densest data display in the race surface and
      //     where label-overflow regressions tend to land.
      await raceFlow.waitForFinishOverlay(60_000)
      await snap('21-finish-seeded')

      // Post-screen snap skipped for the same reason as test 2.
    })

    // ──────────────────────────────────────────────────────────────
    // Test 4 — Falschstart edge. Resume the paused fixture during the
    // SET window (1500 ms after Bereit-tap) so the first stroke
    // arrives before GO!. The reducer transitions
    // Ceremony(SET) → Live(falschstart=true); the FalschstartToast
    // renders for ~2 s before auto-dismissing.
    // ──────────────────────────────────────────────────────────────
    test('capture: falschstart toast (stroke during SET)', async ({
      startBackend,
      seedActiveRower,
      page,
      raceFlow,
    }) => {
      test.setTimeout(60_000)

      const backend = await startBackend({
        fixture: FIXTURE,
        fixtureRate: 'fast',
        fixtureDelay: '0s',
        fixturePaused: true,
        idleTimeout: '30s',
      })
      await seedActiveRower()

      const out = (state: string) => `../test-results/ux-audit/race/${v.name}/${state}.png`
      const snap = async (state: string) => {
        const path = out(state)
        await page.screenshot({ path, fullPage: true })
        await captureLayout(page, path)
      }

      await raceFlow.gotoWorkoutFlow()
      await raceFlow.pickDistance(500)
      await raceFlow.pickIntensity('Moderat')
      await raceFlow.confirmRace({ ghost: true, pb: false })
      await raceFlow.tapBereit()

      // ATTENTION is on-screen immediately after Bereit-tap. Resume
      // the fixture right away so the first stroke lands inside the
      // ATTENTION window (0–1500 ms post-tap). SET would also work,
      // but waiting for SET first risks slipping past GO! on slower
      // viewports (tablet flaked on 'set' here).
      await raceFlow.waitForCeremonyStep('attention', 4_000)
      await resumeFixture(backend)

      // 23. Falschstart toast — visible just after the early stroke
      //     transitions the reducer to Live(falschstart=true).
      await raceFlow.waitForFalschstartToast()
      await snap('23-falschstart-toast')
    })

    // ──────────────────────────────────────────────────────────────
    // Test 5 — Abort edge. Enter Live, tap the Abbrechen pill, snap
    // the confirm sheet, confirm, snap the post-abort destination.
    // ──────────────────────────────────────────────────────────────
    test('capture: abort confirm sheet + post-abort destination', async ({
      startBackend,
      seedActiveRower,
      page,
      raceFlow,
    }) => {
      test.setTimeout(60_000)

      // realtime pacing: with `fast`, all 125 frames would fire in
      // <1 s after GO! and the race would already be at FinishOverlay
      // (where the Abort pill is removed per 0017-02 Option A) by the
      // time we try to tap it. realtime keeps us solidly mid-race
      // when we capture.
      const backend = await startBackend({
        fixture: FIXTURE,
        fixtureRate: 'realtime',
        fixtureDelay: '0s',
        fixturePaused: true,
        idleTimeout: '30s',
      })
      await seedActiveRower()

      const out = (state: string) => `../test-results/ux-audit/race/${v.name}/${state}.png`
      const snap = async (state: string) => {
        const path = out(state)
        await page.screenshot({ path, fullPage: true })
        await captureLayout(page, path)
      }

      await raceFlow.gotoWorkoutFlow()
      await raceFlow.pickDistance(500)
      await raceFlow.pickIntensity('Moderat')
      await raceFlow.confirmRace({ ghost: true, pb: false })
      await raceFlow.tapBereit()

      // Wait through ceremony to Live so a few strokes have flowed —
      // abort-from-Live is the most common real-world case (the others,
      // abort-from-Bereit and abort-from-Ceremony, are covered by the
      // canonical 0016-07 spec).
      await raceFlow.waitForCeremonyStep('go', 6_000)
      await resumeFixture(backend)
      await page.waitForTimeout(5_000)

      // 24. Abort confirm sheet — opens over the live surface. The pill
      //     itself was already visible in the live captures from test 2/3.
      await raceFlow.tapAbbrechen()
      await snap('24-abort-confirm-sheet')

      // 25. Post-abort destination — after confirming. Reducer takes
      //     the user back to Home; the race surface unmounts.
      await raceFlow.confirmAbbrechen()
      // Give the navigation a beat to settle.
      await page.waitForTimeout(1_000)
      await snap('25-post-abort')
    })
  })
}
