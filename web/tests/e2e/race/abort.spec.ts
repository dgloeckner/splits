import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BrowserContext } from '@playwright/test'
import { test, expect } from '../fixtures'
import { pauseFixture, resumeFixture } from '../helpers/backend'
import type { BackendHandle, BackendOptions } from '../helpers/backend'
import type { ViteHandle } from '../helpers/viteServer'
import { seedPriorRaceSession } from '../helpers/seedPriorRaceSession'

/**
 * 0016-07 — Canonical abort-from-each-phase scenarios.
 *
 * Four sub-scenarios cover the Abbrechen affordance (`AbortControl`,
 * see web/src/race/AbortControl.tsx + raceLifecycle.ts) from every
 * phase where the pill is rendered:
 *
 *   A. Abort from Bereit
 *   B. Abort from Ceremony (ATTENTION)
 *   C. Abort from Live (post-GO!, mid-stroke)
 *   D. Finished: Abbrechen pill is NOT in the DOM (PRD-0017 / 0017-02
 *      Option A — finish horn latches the result; abort is unavailable
 *      after the horn fires).
 *
 * Cross-cutting: one of the scenarios also exercises the cancel path
 * (tap pill → cancel → sheet closes, race surface intact).
 *
 * All four use the worker-scoped Vite + dynamic-port backend fixture
 * (0016-01) and the paused-fixture resume endpoint (0016-02). After
 * the deterministic walkthrough each scenario invokes the
 * `e2e-critic` sub-agent (0016-03) with screenshots + the AC list.
 * Per ADR-0014 the critic is advisory on this first integration —
 * blocker findings are logged but do NOT fail the spec.
 *
 * Boat-visibility caveat (0016-05 comment): the user boat sprite has
 * a zero bounding box during ATTENTION because the canvas
 * ResizeObserver has not yet fired. This spec therefore asserts
 * higher-level UI behaviour (confirm sheet visible, race surface
 * unmount, `summary.race == null` over the sessions API) rather than
 * boat visibility pre-GO!.
 *
 * Scenario D contract (PRD-0017 / 0017-02 Option A):
 * --------------------------------------------------
 * The Abbrechen pill is hidden once the FinishOverlay appears: the
 * finish horn latches the race result and abort is unavailable
 * thereafter (CONTEXT.md §Pause/Abort). The spec asserts the pill is
 * NOT in the DOM while the FinishOverlay is visible — there is no
 * gesture to confirm and no backend post-condition to poll. The
 * normal session-end path (idle timeout → `session_end`) is
 * out-of-scope for this spec.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = '../specs/int/fixtures/ipm/session-m3-long.csv'
const SCREENSHOT_ROOT = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'test-results',
  'race-abort',
)

const AC_LIST = [
  'AC1: Spec lives at web/tests/e2e/race/abort.spec.ts.',
  'AC2: All four sub-scenarios use the dynamic-port infra from 0016-01.',
  'AC3: Bereit/Ceremony/Live sub-scenarios: tap Abbrechen → confirm → race surface unmounts.',
  'AC4: After confirm on Bereit, Ceremony, and Live aborts: summary.race == null (polled via sessions API).',
  'AC5: Finished sub-scenario asserts the Abbrechen pill is NOT in the DOM while the FinishOverlay is visible (PRD-0017 / 0017-02 Option A — finish horn latches the result).',
  'AC6: Cancel path: tap Abbrechen → cancel → race surface intact, confirm sheet closed.',
  'AC7: Spec invokes e2e-critic with screenshots + AC list.',
  'AC8: Critic returns no severity: blocker findings against current code.',
  'AC9: Total wall-clock under 90 s for all four sub-scenarios combined.',
]

test.describe('race-flow canonical abort-from-each-phase (0016-07)', () => {
  test.setTimeout(60_000)

  // ── Scenario A: Bereit ────────────────────────────────────────────
  test('Abort from Bereit (+ cancel path)', async ({
    startBackend,
    seedActiveRower,
    raceFlow,
    page,
    context,
    viteWorker,
  }) => {
    const startedAt = Date.now()
    const dir = resolve(SCREENSHOT_ROOT, 'bereit')
    mkdirSync(dir, { recursive: true })

    const backend = await setupBackendAndRower({
      startBackend,
      seedActiveRower,
      context,
      viteWorker,
    })
    const rower = backend.rower

    await raceFlow.gotoWorkoutFlow()
    await raceFlow.pickDistance(500)
    await raceFlow.pickIntensity('Moderat')
    await raceFlow.confirmRace({ ghost: true, pb: true })

    await expect(page.getByTestId('bereit-screen')).toBeVisible()
    await page.screenshot({ path: `${dir}/01-bereit.png` })

    // ── Cancel path first: tap pill → cancel → sheet closes, race
    //    surface intact, BereitScreen still visible. We assert via
    //    DOM presence rather than introspecting the reducer.
    await raceFlow.tapAbbrechen()
    await expect(raceFlow.abortConfirmSheet()).toBeVisible()
    await page.screenshot({ path: `${dir}/02-cancel-sheet-open.png` })
    await raceFlow.cancelAbbrechen()
    await expect(raceFlow.abortConfirmSheet()).toBeHidden()
    await expect(page.getByTestId('bereit-screen')).toBeVisible()
    await expect(raceFlow.abortPill()).toBeVisible()
    await page.screenshot({ path: `${dir}/03-after-cancel.png` })

    // ── Confirm path: tap pill → confirm → race surface unmounts.
    await raceFlow.tapAbbrechen()
    await page.screenshot({ path: `${dir}/04-abort-confirm-sheet.png` })
    await raceFlow.confirmAbbrechen()

    // Race surface unmounts (Aborted returns null in RaceFlow). The
    // /live route may still be mounted by the router, but the
    // race-surface testids must be gone.
    await expect(page.getByTestId('bereit-screen')).toBeHidden({ timeout: 5_000 })
    await expect(raceFlow.abortPill()).toBeHidden()
    await page.screenshot({ path: `${dir}/05-after-confirm.png` })

    // No strokes flowed (fixture stayed paused), so no session may
    // even exist. Assert no ended session has summary.race != null
    // for this rower.
    await expectNoRaceSummary(context.request, rower.id)

    invokeCriticAdvisory(
      buildCriticInput('race-abort-bereit', dir, [
        ['01-bereit', 'BereitScreen — Abbrechen pill visible top-right.'],
        ['02-cancel-sheet-open', 'Confirm sheet open before cancel — BereitScreen visible underneath.'],
        ['03-after-cancel', 'After tapping cancel: sheet closed, BereitScreen + abort pill still present (no side effects).'],
        ['04-abort-confirm-sheet', 'Confirm sheet open before confirming the abort.'],
        ['05-after-confirm', 'After confirming: race surface unmounted (Aborted is terminal in RaceFlow).'],
      ]),
      dir,
    )

    annotateWallClock('bereit', startedAt)
  })

  // ── Scenario B: Ceremony (ATTENTION) ──────────────────────────────
  test('Abort from Ceremony (ATTENTION)', async ({
    startBackend,
    seedActiveRower,
    raceFlow,
    page,
    context,
    viteWorker,
  }) => {
    const startedAt = Date.now()
    const dir = resolve(SCREENSHOT_ROOT, 'ceremony')
    mkdirSync(dir, { recursive: true })

    const setup = await setupBackendAndRower({
      startBackend,
      seedActiveRower,
      context,
      viteWorker,
    })

    await raceFlow.gotoWorkoutFlow()
    await raceFlow.pickDistance(500)
    await raceFlow.pickIntensity('Moderat')
    await raceFlow.confirmRace({ ghost: true, pb: true })

    await raceFlow.tapBereit()
    await raceFlow.waitForCeremonyStep('attention', 4_000)
    await page.screenshot({ path: `${dir}/01-ceremony-attention.png` })

    await raceFlow.tapAbbrechen()
    await page.screenshot({ path: `${dir}/02-abort-confirm-sheet.png` })
    await raceFlow.confirmAbbrechen()

    // Race surface unmounts: ceremony overlay + abort pill gone.
    await expect(page.getByTestId('race-start-sequence')).toBeHidden({ timeout: 5_000 })
    await expect(raceFlow.abortPill()).toBeHidden()
    await page.screenshot({ path: `${dir}/03-after-confirm.png` })

    // No strokes ever arrived (fixture paused throughout). The session
    // may or may not exist — either way, summary.race must be null
    // for any ended session.
    await expectNoRaceSummary(context.request, setup.rower.id)

    invokeCriticAdvisory(
      buildCriticInput('race-abort-ceremony', dir, [
        ['01-ceremony-attention', 'Ceremony ATTENTION phase — Abbrechen pill visible top-right above the countdown.'],
        ['02-abort-confirm-sheet', 'Confirm sheet open mid-ceremony.'],
        ['03-after-confirm', 'After confirming: race surface unmounted; ceremony overlay gone.'],
      ]),
      dir,
    )

    annotateWallClock('ceremony', startedAt)
  })

  // ── Scenario C: Live (post-GO!, mid-stroke) ───────────────────────
  test('Abort from Live (mid-race)', async ({
    startBackend,
    seedActiveRower,
    raceFlow,
    page,
    context,
    viteWorker,
  }) => {
    const startedAt = Date.now()
    const dir = resolve(SCREENSHOT_ROOT, 'live')
    mkdirSync(dir, { recursive: true })

    // Realtime pacing, deliberately: at `fast` the whole CSV flushes
    // within ms of the resume, the 500 m are crossed and the post screen
    // is up before anything can be aborted "mid-race" (the pill is gone
    // with the race surface). At ~0.5 Hz the first frame lands on resume
    // and the race is nowhere near the finish while we abort.
    const setup = await setupBackendAndRower(
      { startBackend, seedActiveRower, context, viteWorker },
      { fixtureRate: 'realtime' },
    )
    const backend = setup.backend

    await raceFlow.gotoWorkoutFlow()
    await raceFlow.pickDistance(500)
    await raceFlow.pickIntensity('Moderat')
    await raceFlow.confirmRace({ ghost: true, pb: true })

    await raceFlow.tapBereit()
    // Step through the ceremony rather than waiting for GO! alone: GO!
    // is on screen only from ~3.0 s to ~4.5 s after the tap (relative to
    // when the sequence mounts), so a single 5 s wait misses it whenever
    // the mount is late on a loaded runner.
    await raceFlow.waitForCeremonyStep('attention', 4_000)
    await raceFlow.waitForCeremonyStep('set', 4_000)
    await raceFlow.waitForCeremonyStep('go', 4_000)
    await raceFlow.waitForLive()
    await resumeFixture(backend)

    // Mid-race: the client shows the first frame's distance right away,
    // but the sessionizer books a stroke only once a later frame advances
    // past it — and the sessions list carries sessions with strokes only.
    // The fixture advances ~8 m per frame, so 30 m means several booked
    // strokes. At realtime pacing that is a few seconds in; the finish is
    // nowhere near.
    await raceFlow.waitForUserDistance(30)
    await expect(page.getByTestId('finish-overlay')).toBeHidden()
    await page.screenshot({ path: `${dir}/01-mid-live.png` })

    await raceFlow.tapAbbrechen()
    await page.screenshot({ path: `${dir}/02-abort-confirm-sheet.png` })
    await raceFlow.confirmAbbrechen()

    await expect(raceFlow.raceCanvas()).toBeHidden({ timeout: 5_000 })
    await expect(raceFlow.abortPill()).toBeHidden()
    await page.screenshot({ path: `${dir}/03-after-confirm.png` })

    // Confirming the abort unmounts the race surface but does not end
    // the backend session (LivePage passes the overlay-only `abort`, not
    // the enqueueEndSession path the X-abort uses); a real rower simply
    // stops rowing and the session closes on its own. Model that: stop
    // the fixture, and the pause detector closes the session after
    // PauseTimeout + ResumeWindow (see setupBackendAndRower). The `fast`
    // variant of this test got the same effect from the fixture's EOF.
    await pauseFixture(backend)

    // Some strokes arrived but the rower aborted before 500 m, so the
    // backend's ComputeRaceResult returns nil → summary.race == null.
    await expectRaceSummaryNullOnEnded(context.request, setup.rower.id, 40_000)

    invokeCriticAdvisory(
      buildCriticInput('race-abort-live', dir, [
        ['01-mid-live', 'Mid-Live, ~2 s post-GO!. Strokes have begun flowing; abort pill still tappable.'],
        ['02-abort-confirm-sheet', 'Confirm sheet open mid-race.'],
        ['03-after-confirm', 'After confirming: race surface unmounted; canvas + pill gone.'],
      ]),
      dir,
    )

    annotateWallClock('live', startedAt)
  })

  // ── Scenario D: Finished — pill must be absent ────────────────────
  test('On Finished the Abbrechen pill is absent (PRD-0017 / 0017-02 Option A)', async ({
    startBackend,
    seedActiveRower,
    raceFlow,
    page,
    context,
    viteWorker,
  }) => {
    const startedAt = Date.now()
    const dir = resolve(SCREENSHOT_ROOT, 'finished')
    mkdirSync(dir, { recursive: true })

    const setup = await setupBackendAndRower({
      startBackend,
      seedActiveRower,
      context,
      viteWorker,
    })
    const backend = setup.backend

    await raceFlow.gotoWorkoutFlow()
    await raceFlow.pickDistance(500)
    await raceFlow.pickIntensity('Moderat')
    await raceFlow.confirmRace({ ghost: true, pb: true })

    await raceFlow.tapBereit()
    // Stepwise for the same reason as in the Live scenario above, and
    // release the fixture only once the reducer is in Live (see
    // RaceFlowPage.waitForLive): at `fast` pacing the whole CSV flushes
    // at once, and strokes that land while "GO!" is still on screen are
    // pre-GO for the reducer — the race then never crosses 500 m.
    await raceFlow.waitForCeremonyStep('attention', 4_000)
    await raceFlow.waitForCeremonyStep('set', 4_000)
    await raceFlow.waitForCeremonyStep('go', 4_000)
    await raceFlow.waitForLive()
    await resumeFixture(backend)

    // Let the race run to finish-cross + FinishOverlay.
    await raceFlow.waitForFinishOverlay(45_000)
    await page.screenshot({ path: `${dir}/01-finish-overlay.png` })

    // PRD-0017 / 0017-02 Option A: once the finish horn fires the
    // result is latched (CONTEXT.md §Finish horn) and abort is
    // unavailable. The Abbrechen pill must NOT be in the DOM while
    // the FinishOverlay is visible.
    await expect(raceFlow.abortPill()).toHaveCount(0)
    await page.screenshot({ path: `${dir}/02-pill-absent.png` })

    invokeCriticAdvisory(
      buildCriticInput('race-abort-finished', dir, [
        ['01-finish-overlay', 'FinishOverlay shown after 500 m crossed — abort pill must be absent (Option A).'],
        ['02-pill-absent', 'Confirmation: no abort-pill in the DOM while FinishOverlay is visible.'],
      ]),
      dir,
    )

    annotateWallClock('finished', startedAt)
  })
})

// ── helpers ─────────────────────────────────────────────────────────

async function setupBackendAndRower(
  ctx: {
    startBackend: (opts?: BackendOptions) => Promise<BackendHandle>
    seedActiveRower: (opts?: { name?: string }) => Promise<{ id: string }>
    context: BrowserContext
    viteWorker: { vite: ViteHandle; viteUrl: string; backendPort: number }
  },
  overrides: Partial<BackendOptions> = {},
): Promise<{ backend: BackendHandle; rower: { id: string } }> {
  // Backend FIRST (Vite proxy needs a target before any /api/* call).
  // Fixture is paused so the test controls exactly when strokes flow.
  const backend = await ctx.startBackend({
    addr: `127.0.0.1:${ctx.viteWorker.backendPort}`,
    fixture: FIXTURE,
    fixtureRate: 'fast',
    fixtureDelay: '0s',
    fixturePaused: true,
    // Longer than the whole pre-stroke stretch (confirm → ceremony →
    // first frame, ~8 s with the Live wait). The session the client
    // opens on confirm has seen no frame yet; if the first one lands
    // after IdleTimeout the sessionizer closes it as stale and opens a
    // new one, and the client reads that session_end as the race being
    // over (post screen, "Endzeit 0:00"). With 5 s that was a coin
    // flip on a loaded runner.
    idleTimeout: '20s',
    // How the Live scenario's session ends after the abort: IdleTimeout
    // is only evaluated on incoming frames, so once the fixture is paused
    // the wall-clock pause detector is the path that closes it — silence
    // for PauseTimeout enters Paused, and Paused closes after
    // ResumeWindow (default 15 min). 10 s + 5 s keeps that inside the
    // test budget. Pre-stroke, the detector stays off (no activity yet).
    pauseTimeout: '10s',
    resumeWindow: '5s',
    ...overrides,
  })
  const rower = await ctx.seedActiveRower()
  await seedPriorRaceSession(ctx.context.request, {
    meters: 500,
    intensity: 'moderat',
  })
  return { backend, rower }
}

/**
 * Poll the sessions API and assert that NO ended session for this
 * rower carries a non-null `summary.race`. Used for the pre-stroke
 * abort scenarios where the user never reached the goal distance.
 *
 * We tolerate "no session at all" (Bereit-phase aborts may never
 * have created one) — that satisfies the AC: the absence of a
 * race-summary session is the same outcome as one explicitly
 * persisted with `summary.race = null`.
 */
async function expectNoRaceSummary(
  request: {
    get(url: string): Promise<{ ok(): boolean; json(): Promise<unknown> }>
  },
  rowerID: string,
  windowMs = 4_000,
): Promise<void> {
  // Single sample after a small window: we want to be sure no race
  // summary ever lands. Spinning is unnecessary because nothing
  // should ever create it.
  await new Promise((r) => setTimeout(r, windowMs))
  const r = await request.get(
    `/api/v1/sessions?rower_id=${encodeURIComponent(rowerID)}&limit=10`,
  )
  if (!r.ok()) return // 502/transient — backend wasn't reachable; that's a no-race-summary by definition.
  const body = (await r.json()) as {
    sessions?: Array<{
      id: string
      ended_at?: string
      summary?: { race?: unknown } | null
    }>
  }
  const offenders = (body.sessions ?? [])
    .filter((s) => !!s.ended_at)
    .filter(
      (s) => s.summary != null && (s.summary as { race?: unknown }).race != null,
    )
  expect(
    offenders,
    `expected no ended session with summary.race != null for ${rowerID}, got ${JSON.stringify(offenders)}`,
  ).toEqual([])
}

/**
 * Poll until at least one ended session exists for this rower and
 * assert its `summary.race` is null. Used for the Live-phase abort
 * where strokes flowed before the abort.
 */
async function expectRaceSummaryNullOnEnded(
  request: {
    get(url: string): Promise<{ ok(): boolean; json(): Promise<unknown> }>
  },
  rowerID: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastBody: unknown = null
  while (Date.now() < deadline) {
    try {
      const r = await request.get(
        `/api/v1/sessions?rower_id=${encodeURIComponent(rowerID)}&limit=10`,
      )
      if (r.ok()) {
        const body = (await r.json()) as {
          sessions?: Array<{
            id: string
            ended_at?: string
            summary?: { race?: unknown } | null
          }>
        }
        lastBody = body
        const ended = (body.sessions ?? []).filter((s) => !!s.ended_at)
        if (ended.length > 0) {
          const offenders = ended.filter(
            (s) => s.summary != null && (s.summary as { race?: unknown }).race != null,
          )
          expect(
            offenders,
            `expected summary.race == null on all ended sessions, offenders=${JSON.stringify(offenders)}`,
          ).toEqual([])
          return
        }
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(
    `expectRaceSummaryNullOnEnded: no ended session for ${rowerID} within ${timeoutMs}ms; lastBody=${JSON.stringify(lastBody)}`,
  )
}

function annotateWallClock(scenario: string, startedAt: number): void {
  const elapsedMs = Date.now() - startedAt
  test.info().annotations.push({
    type: 'wall-clock',
    description: `${scenario}: ${(elapsedMs / 1000).toFixed(1)} s (combined budget 90 s across all four scenarios)`,
  })
  if (elapsedMs > 30_000) {
    console.warn(
      `[0016-07] ${scenario} took ${(elapsedMs / 1000).toFixed(1)} s — investigate runner contention.`,
    )
  }
}

function buildCriticInput(
  scenarioName: string,
  dir: string,
  steps: Array<[string, string]>,
): unknown {
  return {
    scenario_name: scenarioName,
    ac_list: AC_LIST,
    screens: steps.map(([stepId, description]) => ({
      step_id: stepId,
      screenshot_path: `${dir}/${stepId}.png`,
      description,
    })),
  }
}

/**
 * Run the e2e-critic sub-agent against the captured screenshots.
 * Mirrors happy-path.spec.ts / falschstart.spec.ts. Findings → JSON
 * file alongside the screenshots; on this first integration blocker
 * findings are surfaced as warnings only (ADR-0014).
 */
function invokeCriticAdvisory(input: unknown, dir: string): void {
  const which = spawnSync('which', ['claude'], { encoding: 'utf8' })
  if (which.status !== 0 || !which.stdout.trim()) {
    console.warn('[0016-07] claude CLI not on PATH — skipping e2e-critic advisory pass.')
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
    writeFileSync(`${dir}/critic.json`, stdout || '{"findings": []}')
    if (stderr) writeFileSync(`${dir}/critic.stderr.txt`, stderr)
  } catch {
    /* best effort */
  }
  console.log(`[0016-07] e2e-critic exit=${result.status}; output → ${dir}/critic.json`)
}
