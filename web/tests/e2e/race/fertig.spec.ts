import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '../fixtures'
import { resumeFixture } from '../helpers/backend'
import { seedPriorRaceSession } from '../helpers/seedPriorRaceSession'

/**
 * 0019-03 — Fertig button + remove "Paddelst aus..." label.
 *
 * Two scenarios:
 *   1. Happy path. Rower walks to FinishOverlay, taps Fertig, lands on
 *      Home; backend session row carries `ended_at != null`.
 *   2. Idle-timeout fallback. Same walkthrough, but no Fertig tap. The
 *      backend's idle timer must finalise the session anyway.
 *
 * Test infrastructure pattern follows freeze.spec.ts and happy-path.spec.ts.
 *
 * Idle-timeout configuration: `startBackend` lets us override
 * SPLITS_IDLE_TIMEOUT per test. The default is 2 s; we keep that for the
 * idle-fallback test so the regression check is cheap. For the happy
 * path we set a generous 30 s so the test never accidentally races the
 * idle timer to its own click.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = '../specs/int/fixtures/ipm/session-m3-long.csv'
const SCREENSHOT_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'test-results',
  '0019-03-fertig',
)

const AC_LIST = [
  'AC1: FinishOverlay renders a "Fertig" button when given a result.',
  'AC2: The Fertig button is enabled the moment the overlay mounts.',
  'AC3: Tapping Fertig invokes onFinish exactly once; in the wired parent it fires session_end via the existing endSessionQueue path.',
  'AC4: After tapping Fertig the race surface dismisses and the rower lands on Home (/).',
  'AC5: The text "Paddelst aus" appears nowhere in the rendered output.',
  'AC6: The idle-timeout session_end path still fires for rowers who walk away without tapping anything (regression).',
]

test.describe('FinishOverlay Fertig button (0019-03)', () => {
  // Mobile-first PWA: match the convention used by ux-audit/race-capture.spec.ts:49.
  test.use({ viewport: { width: 390, height: 844 } })
  test.setTimeout(120_000)

  // ── Test 1: Happy path ────────────────────────────────────────────
  test('Fertig taps cleanly through FinishOverlay → Home with backend session ended', async ({
    startBackend,
    seedActiveRower,
    raceFlow,
    page,
    context,
    viteWorker,
  }) => {
    const startedAt = Date.now()
    mkdirSync(SCREENSHOT_DIR, { recursive: true })

    // Very generous idle timeout. At PacingFast the entire CSV flushes
    // within milliseconds of `resumeFixture`; the backend's idle timer
    // then starts the session_end countdown from that last-stroke
    // instant. If the idle timer is short, the summary arrives over
    // SSE while the test is still poised to click Fertig — and the
    // LivePage's `SessionEndedOverlay` (a modal scrim) renders over
    // the FinishOverlay, intercepting the Fertig click and blowing
    // out the test timeout. 5 m gives us plenty of headroom: the
    // Fertig tap is unambiguously what ends this session.
    const backend = await startBackend({
      addr: `127.0.0.1:${viteWorker.backendPort}`,
      fixture: FIXTURE,
      fixtureRate: 'fast',
      fixtureDelay: '0s',
      fixturePaused: true,
      idleTimeout: '5m',
    })

    const rower = await seedActiveRower()
    await seedPriorRaceSession(context.request, { meters: 500, intensity: 'moderat' })

    await raceFlow.gotoWorkoutFlow()
    await raceFlow.pickDistance(500)
    await raceFlow.pickIntensity('Moderat')
    await raceFlow.confirmRace({ ghost: true, pb: true })

    await expect(page.getByTestId('bereit-screen')).toBeVisible()
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-bereit.png` })
    await raceFlow.tapBereit()

    await raceFlow.waitForCeremonyStep('attention', 4_000)
    await raceFlow.waitForCeremonyStep('set', 3_000)
    await raceFlow.waitForCeremonyStep('go', 3_000)
    // Release only once the reducer is in Live (RaceFlowPage.waitForLive):
    // strokes that land while "GO!" is still on screen are pre-GO, and at
    // `fast` pacing that can be the entire CSV.
    await raceFlow.waitForLive()
    await resumeFixture(backend)

    // Best-effort mid-race screenshot. At fast pacing this may already
    // be past finish-cross — that's fine, the FinishOverlay capture
    // below is the load-bearing frame.
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-mid-race.png` })

    // ── FinishOverlay assertions ─────────────────────────────────────
    // ORDER MATTERS HERE. The PacingFast fixture replayer hits EOF
    // within milliseconds of `resumeFixture` (the entire CSV flushes
    // in one tick), which causes the sessionizer to close the session
    // and emit `session_end` essentially immediately. On the client,
    // that `summary` arrival makes the LivePage render
    // `SessionEndedOverlay` (a modal scrim) over the FinishOverlay —
    // and once that scrim is up it intercepts the Fertig click, even
    // though the button itself is visible and enabled. To stay clear
    // of that race we (a) snapshot the session id BEFORE waiting on
    // the overlay (the open-session list is the durable signal) and
    // (b) issue the Fertig click as soon as the button is enabled,
    // then do the visual + text spot-checks against the rendered DOM
    // afterward.
    const preSessionsResp = await context.request.get(
      `/api/v1/sessions?rower_id=${encodeURIComponent(rower.id)}&limit=5`,
    )
    let sessionId: string | null = null
    if (preSessionsResp.ok()) {
      const body = (await preSessionsResp.json()) as {
        sessions?: Array<{ id: string; ended_at?: string }>
      }
      sessionId = body.sessions?.[0]?.id ?? null
    }

    await raceFlow.waitForFinishOverlay(60_000)
    const overlay = page.getByTestId('finish-overlay')

    // Spot-check #2 first (the click target). Wait for it to be
    // enabled, then capture the rendered snapshot for the AC checks
    // before the SessionEndedOverlay can race in.
    const fertig = page.getByTestId('finish-fertig')
    await expect(fertig).toBeVisible()
    await expect(fertig).toBeEnabled()

    // 0019-09 spot-check: Fertig must sit fully above the BottomNav and
    // fully within the viewport (no clipping). Catches regressions of
    // the "fixed/absolute bottom-anchored control escapes the nav
    // reserved zone" class of bug.
    {
      const fertigBox = await fertig.boundingBox()
      const navBox = await page.getByTestId('bottom-nav-workout').boundingBox()
      const viewport = page.viewportSize()
      expect(fertigBox, 'finish-fertig must have a bounding box').not.toBeNull()
      expect(navBox, 'bottom-nav-workout must have a bounding box').not.toBeNull()
      expect(viewport, 'viewport size required for clipping check').not.toBeNull()
      if (fertigBox && navBox && viewport) {
        expect(
          fertigBox.y + fertigBox.height,
          `Fertig bottom (${fertigBox.y + fertigBox.height}) must be <= nav top (${navBox.y}) — 0019-09 reserved-zone`,
        ).toBeLessThanOrEqual(navBox.y)
        expect(
          fertigBox.y + fertigBox.height,
          `Fertig bottom must be within viewport height (${viewport.height})`,
        ).toBeLessThanOrEqual(viewport.height)
        expect(fertigBox.y, 'Fertig top must be within viewport').toBeGreaterThanOrEqual(0)
      }
    }

    const accName = ((await fertig.textContent()) ?? '').trim()
    expect(accName, 'Fertig button accessible name should be "Fertig"').toBe('Fertig')

    // Spot-check #1: no "Paddelst aus" anywhere in the overlay.
    const overlayText = (await overlay.textContent()) ?? ''
    expect(
      overlayText,
      'FinishOverlay must not contain the "Paddelst aus..." label (removed in 0019-03)',
    ).not.toMatch(/Paddelst aus/i)

    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-finish-overlay-with-fertig.png` })

    // Spot-check #3: tap Fertig → navigation to /. The PacingFast
    // fixture EOF races session_end — and with it the PBOverlay scrim —
    // in front of the button. A `force: true` click does not help: it
    // skips the actionability checks but the pointer event still lands
    // on the scrim, so the tap never reaches Fertig (observed in CI).
    // tapFertig() dismisses the PB stack first and then taps for real.
    if (sessionId === null) {
      // The session-list snapshot above raced ahead of session_start —
      // probe once more now that the overlay is up.
      const retry = await context.request.get(
        `/api/v1/sessions?rower_id=${encodeURIComponent(rower.id)}&limit=5`,
      )
      if (retry.ok()) {
        const body = (await retry.json()) as {
          sessions?: Array<{ id: string }>
        }
        sessionId = body.sessions?.[0]?.id ?? null
      }
    }
    expect(sessionId, 'expected at least one session row for the seeded rower').not.toBeNull()

    await raceFlow.tapFertig()
    await page.waitForURL((url) => url.pathname === '/', { timeout: 10_000 })
    // FinishOverlay must be gone (race surface dismissed).
    await expect(overlay).toBeHidden({ timeout: 5_000 })
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-home-after-fertig.png` })

    // Spot-check #4: backend session row has ended_at != null. Poll
    // briefly because the session_end event is fire-and-forget from the
    // client (enqueueEndSession → processPendingEndSessions runs async).
    const deadline = Date.now() + 15_000
    let endedAt: string | null = null
    let lastBody: unknown = null
    while (Date.now() < deadline) {
      const r = await context.request.get(`/api/v1/sessions/${sessionId}`)
      if (r.ok()) {
        const body = (await r.json()) as {
          session?: { id: string; ended_at?: string | null }
          id?: string
          ended_at?: string | null
        }
        lastBody = body
        // The endpoint may return either { session: {...} } or the row
        // flat — handle both shapes defensively.
        const flat = (body.session ?? body) as { ended_at?: string | null }
        if (flat?.ended_at) {
          endedAt = flat.ended_at
          break
        }
      }
      await page.waitForTimeout(250)
    }
    expect(
      endedAt,
      `backend session ${sessionId} should have ended_at != null within 15 s of Fertig tap; lastBody=${JSON.stringify(lastBody)}`,
    ).not.toBeNull()

    invokeCriticAdvisory({
      scenario_name: '0019-03-fertig-happy-path',
      ac_list: AC_LIST,
      screens: [
        {
          step_id: '01-bereit',
          screenshot_path: `${SCREENSHOT_DIR}/01-bereit.png`,
          description: 'BereitScreen before tapping Bereit.',
        },
        {
          step_id: '02-mid-race',
          screenshot_path: `${SCREENSHOT_DIR}/02-mid-race.png`,
          description: 'Best-effort mid-race frame (fast fixture may already be past finish).',
        },
        {
          step_id: '03-finish-overlay-with-fertig',
          screenshot_path: `${SCREENSHOT_DIR}/03-finish-overlay-with-fertig.png`,
          description:
            'FinishOverlay just appeared. Header reads "Ziel!" only (no "Paddelst aus..."); a clearly labelled "Fertig" button is visible and enabled.',
        },
        {
          step_id: '04-home-after-fertig',
          screenshot_path: `${SCREENSHOT_DIR}/04-home-after-fertig.png`,
          description:
            'Home screen after tapping Fertig. Race surface dismissed, bottom-nav back in normal state.',
        },
      ],
    })

    const elapsedMs = Date.now() - startedAt
    test.info().annotations.push({
      type: 'wall-clock',
      description: `happy path: ${(elapsedMs / 1000).toFixed(1)} s`,
    })
  })

  // ── Test 2: Idle-timeout fallback regression ──────────────────────
  test('idle-timeout still finalises the session when Fertig is not tapped', async ({
    startBackend,
    seedActiveRower,
    raceFlow,
    page,
    context,
    viteWorker,
  }) => {
    const startedAt = Date.now()
    mkdirSync(SCREENSHOT_DIR, { recursive: true })

    // Short idle timeout so this regression check finishes quickly.
    // 3 s is the same order-of-magnitude as the existing abort.spec
    // (5 s) and happy-path.spec.ts (5 s) idleTimeout overrides.
    const backend = await startBackend({
      addr: `127.0.0.1:${viteWorker.backendPort}`,
      fixture: FIXTURE,
      fixtureRate: 'fast',
      fixtureDelay: '0s',
      fixturePaused: true,
      idleTimeout: '3s',
    })

    const rower = await seedActiveRower()
    await seedPriorRaceSession(context.request, { meters: 500, intensity: 'moderat' })

    await raceFlow.gotoWorkoutFlow()
    await raceFlow.pickDistance(500)
    await raceFlow.pickIntensity('Moderat')
    await raceFlow.confirmRace({ ghost: true, pb: true })

    await raceFlow.tapBereit()
    await raceFlow.waitForCeremonyStep('go', 8_000)
    await resumeFixture(backend)

    // Deliberately DO NOT tap Fertig. At fast fixture pacing the entire
    // CSV (~1035 m) flushes in milliseconds, so the IPM stream goes
    // idle on its own. The backend's 3 s sessionizer idle timer must
    // then fire session_end without any user interaction.
    //
    // 0019-08: in race mode `SessionEndedOverlay` is suppressed — the
    // race surface (FinishOverlay → RacePostScreen) owns the
    // post-session UI. When session_end arrives with the lifecycle
    // still in Live (no line-cross latched), the reducer transitions
    // Live → Post and `RaceFlow` renders `RacePostScreen` directly,
    // even when `latchedResult` is null. That is the user-observable
    // signal that the backend finalised the session unprompted.
    const overlay = page.getByTestId('race-post-screen')
    await expect(
      overlay,
      'idle timeout must finalise the session: RacePostScreen should render once the backend publishes the session_end summary over SSE (0019-08: race mode no longer uses SessionEndedOverlay)',
    ).toBeVisible({ timeout: 30_000 })

    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-idle-fallback-finished.png` })

    // Bonus assertion: RacePostScreen exposes an "Erneut rennen" CTA
    // that re-enters the race flow. The acknowledgement path on the
    // race surface is "Detail" → history view, not Fertig → home, so
    // we just confirm the post screen is interactive.
    await expect(page.getByRole('button', { name: 'Erneut rennen' })).toBeVisible()

    const elapsedMs = Date.now() - startedAt
    test.info().annotations.push({
      type: 'wall-clock',
      description: `idle fallback: ${(elapsedMs / 1000).toFixed(1)} s`,
    })
  })
})

/**
 * Run the e2e-critic sub-agent against the captured screenshots.
 * Mirrors freeze.spec.ts. Findings → critic.json alongside the
 * screenshots; blocker findings surface as warnings only on this first
 * integration (ADR-0014).
 */
function invokeCriticAdvisory(input: unknown): void {
  const which = spawnSync('which', ['claude'], { encoding: 'utf8' })
  if (which.status !== 0 || !which.stdout.trim()) {
    // eslint-disable-next-line no-console
    console.warn('[0019-03] claude CLI not on PATH — skipping e2e-critic advisory pass.')
    return
  }
  const prompt = [
    'You are being invoked as the e2e-critic sub-agent. The following JSON is your input contract payload. Read each screenshot via the Read tool and emit exactly one JSON document to stdout matching the schema in your sub-agent definition. Exit non-zero iff any finding has severity "blocker".',
    '',
    'INPUT:',
    JSON.stringify(input, null, 2),
  ].join('\n')
  const result = spawnSync(
    'claude',
    ['-p', '--agent', 'e2e-critic', '--permission-mode', 'bypassPermissions', prompt],
    { encoding: 'utf8', timeout: 5 * 60_000 },
  )
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  try {
    writeFileSync(`${SCREENSHOT_DIR}/critic.json`, stdout || '{"findings": []}')
    if (stderr) writeFileSync(`${SCREENSHOT_DIR}/critic.stderr.txt`, stderr)
  } catch {
    /* best effort */
  }
  // eslint-disable-next-line no-console
  console.log(`[0019-03] e2e-critic exit=${result.status}; output → ${SCREENSHOT_DIR}/critic.json`)
}
