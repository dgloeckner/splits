import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '../fixtures'
import { seedStaleOpenSession } from '../helpers/seedStaleOpenSession'

/**
 * 0019-05 — Race-mode stale-open recovery card.
 *
 * Verifies the `Frühere Session abschließen?` card on Home renders
 * correctly for race-mode stale-open rows and that the Finalize /
 * Discard handlers behave per ADR-0012 (race-mode non-resumable):
 *
 *   - race row → Finalize + Discard buttons only (no "rejoin live"),
 *   - Finalize closes the session with `ended_at != null` AND
 *     `summary_json.race == null`,
 *   - Discard hard-deletes the session,
 *   - non-race stale-open keeps the 3-button card (regression).
 *
 * Seeding is direct sqlite3 manipulation (mirrors insights.spec.ts):
 * the backend has no test-only stale-open seed endpoint, but the
 * production stale-open shape — session row with `ended_at IS NULL`
 * + `status='stale-open'` + one stroke timestamped past the
 * threshold — can be produced via straight SQL against the worker DB.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENSHOT_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'test-results',
  '0019-05-recovery-card',
)

const AC_LIST = [
  'AC1: Race-mode stale-open session renders the stale-open-recovery-card on Home.',
  'AC2: Inside the race card, Finalize and Discard buttons are present and interactive.',
  'AC3: Inside the race card, the Rejoin ("Weiter rudern") button is absent (ADR-0012).',
  'AC4: After Finalize: backend session row has ended_at IS NOT NULL.',
  'AC5: After Finalize: backend session row has summary_json.race == null.',
  'AC6: After Discard: backend session row is removed (404 on subsequent GET).',
  'AC7: Non-race stale-open session renders the 3-button card including stale-recovery-rejoin (regression).',
]

test.describe('stale-open recovery card (0019-05)', () => {
  // Mobile-first PWA: same viewport as the rest of the 0019 specs.
  test.use({ viewport: { width: 390, height: 844 } })
  test.setTimeout(90_000)

  // ── Test 1: Race-mode stale-open → 2-button card ────────────────
  test('race-mode stale-open shows Finalize + Discard only (no Rejoin)', async ({
    startBackend,
    seedActiveRower,
    page,
    context,
  }) => {
    const startedAt = Date.now()
    mkdirSync(SCREENSHOT_DIR, { recursive: true })

    // No fixture: we don't need the IPM replayer for this test, we
    // just need a backend with a DB so we can seed the row directly.
    const backend = await startBackend({ idleTimeout: '5m' })
    const rower = await seedActiveRower()

    // ── Sub-scenario A: Finalize path ───────────────────────────────
    const seededA = seedStaleOpenSession({
      dbPath: backend.dbPath,
      rowerID: rower.id,
      mode: 'race',
      params: { meters: 500 },
      ageMinutes: 30,
    })

    await page.goto('/')

    // Wait for the recovery card to render. The query has a 30s
    // staleTime; on a fresh page load the first fetch fires
    // immediately so this should appear within a second.
    const card = page.getByTestId('stale-open-recovery-card')
    await expect(card, 'recovery card must render for race-mode stale-open').toBeVisible({
      timeout: 10_000,
    })
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-race-stale-card.png` })

    // AC2 + AC3: race card exposes Finalize + Discard only.
    const finalize = card.getByTestId('stale-recovery-finalize')
    const discard = card.getByTestId('stale-recovery-discard')
    const rejoin = card.getByTestId('stale-recovery-rejoin')
    await expect(finalize).toBeVisible()
    await expect(finalize).toBeEnabled()
    await expect(discard).toBeVisible()
    await expect(discard).toBeEnabled()
    expect(
      await rejoin.count(),
      'race-mode card must NOT render a Rejoin ("Weiter rudern") button (ADR-0012)',
    ).toBe(0)

    // 0019-09 spot-check: Discard must sit fully above the BottomNav
    // and fully within the viewport (no clipping). The card is the
    // last child on Home and used to be partially occluded by the nav
    // at 390x844 — the fix lives in StaleSessionCard.module.css
    // (margin-bottom: var(--layout-bottom-nav-h)).
    {
      const discardBox = await discard.boundingBox()
      const navBox = await page.getByTestId('bottom-nav-workout').boundingBox()
      const viewport = page.viewportSize()
      expect(discardBox, 'stale-recovery-discard must have a bounding box').not.toBeNull()
      expect(navBox, 'bottom-nav-workout must have a bounding box').not.toBeNull()
      expect(viewport, 'viewport size required for clipping check').not.toBeNull()
      if (discardBox && navBox && viewport) {
        expect(
          discardBox.y + discardBox.height,
          `Discard bottom (${discardBox.y + discardBox.height}) must be <= nav top (${navBox.y}) — 0019-09 reserved-zone`,
        ).toBeLessThanOrEqual(navBox.y)
        expect(
          discardBox.y + discardBox.height,
          `Discard bottom must be within viewport height (${viewport.height})`,
        ).toBeLessThanOrEqual(viewport.height)
        expect(discardBox.y, 'Discard top must be within viewport').toBeGreaterThanOrEqual(0)
      }
    }

    // ── AC4 + AC5: Finalize ────────────────────────────────────────
    await finalize.click()

    // Card disappears after invalidation re-queries.
    await expect(card, 'card should clear after Finalize').toBeHidden({ timeout: 10_000 })
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-after-finalize.png` })

    // Poll the backend session row for ended_at + summary.race==null.
    const deadline = Date.now() + 15_000
    let endedAt: string | null = null
    let raceField: unknown = 'unread'
    let lastBody: unknown = null
    while (Date.now() < deadline) {
      const r = await context.request.get(`/api/v1/sessions/${seededA.sessionID}`)
      if (r.ok()) {
        const body = (await r.json()) as {
          session?: { ended_at?: string | null; summary?: { race?: unknown } }
          ended_at?: string | null
          summary?: { race?: unknown }
        }
        lastBody = body
        const flat = (body.session ?? body) as {
          ended_at?: string | null
          summary?: { race?: unknown }
        }
        if (flat?.ended_at) {
          endedAt = flat.ended_at
          // summary may omit race when nil (json:"race,omitempty"). Treat
          // missing as null.
          raceField = flat.summary?.race ?? null
          break
        }
      }
      await page.waitForTimeout(250)
    }
    expect(
      endedAt,
      `backend session ${seededA.sessionID} should have ended_at != null within 15 s of Finalize; lastBody=${JSON.stringify(lastBody)}`,
    ).not.toBeNull()
    expect(
      raceField,
      `summary_json.race must be null after race-mode Finalize (ADR-0012); got ${JSON.stringify(raceField)}`,
    ).toBeNull()

    // ── Sub-scenario B: Discard path ───────────────────────────────
    const seededB = seedStaleOpenSession({
      dbPath: backend.dbPath,
      rowerID: rower.id,
      mode: 'race',
      params: { meters: 500 },
      ageMinutes: 30,
    })

    // Reload to re-fetch the stale-open list — the prior list is
    // cached on the QueryClient and was invalidated above, but the
    // simplest way to surface the new seeded row is a full reload.
    await page.goto('/')
    const cardB = page.getByTestId('stale-open-recovery-card')
    await expect(cardB).toBeVisible({ timeout: 10_000 })

    await cardB.getByTestId('stale-recovery-discard').click()
    await expect(cardB, 'card should clear after Discard').toBeHidden({ timeout: 10_000 })
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-after-discard.png` })

    // AC6: backend session row removed.
    const discardDeadline = Date.now() + 10_000
    let lastStatus = -1
    while (Date.now() < discardDeadline) {
      const r = await context.request.get(`/api/v1/sessions/${seededB.sessionID}`)
      lastStatus = r.status()
      if (r.status() === 404) break
      await page.waitForTimeout(250)
    }
    expect(
      lastStatus,
      `discarded session must return 404 from GET /sessions/{id} (got ${lastStatus})`,
    ).toBe(404)

    invokeCriticAdvisory({
      scenario_name: '0019-05-race-stale-recovery-card',
      ac_list: AC_LIST,
      screens: [
        {
          step_id: '01-race-stale-card',
          screenshot_path: `${SCREENSHOT_DIR}/01-race-stale-card.png`,
          description:
            'Home screen with a race-mode stale-open recovery card visible. Card must show "Frühere Session abschließen?" header, the seeded session line, and exactly two action buttons: Finalize ("Beenden mit gerudertem Stand") and Discard ("Verwerfen"). No "Weiter rudern" (Rejoin) button (ADR-0012).',
        },
        {
          step_id: '02-after-finalize',
          screenshot_path: `${SCREENSHOT_DIR}/02-after-finalize.png`,
          description:
            'Home after tapping Finalize. The recovery card has cleared because the session was closed; backend row now has ended_at set and summary_json.race == null.',
        },
        {
          step_id: '03-after-discard',
          screenshot_path: `${SCREENSHOT_DIR}/03-after-discard.png`,
          description:
            'Home after tapping Discard on a second seeded race-mode stale-open session. Card cleared because the session row was hard-deleted.',
        },
      ],
    })

    const elapsedMs = Date.now() - startedAt
    test.info().annotations.push({
      type: 'wall-clock',
      description: `race-mode recovery: ${(elapsedMs / 1000).toFixed(1)} s`,
    })
  })

  // ── Test 2: Non-race stale-open → 3-button card (regression) ────
  test('non-race stale-open shows Finalize + Discard + Rejoin (regression)', async ({
    startBackend,
    seedActiveRower,
    page,
  }) => {
    const startedAt = Date.now()
    mkdirSync(SCREENSHOT_DIR, { recursive: true })

    const backend = await startBackend({ idleTimeout: '5m' })
    const rower = await seedActiveRower()

    seedStaleOpenSession({
      dbPath: backend.dbPath,
      rowerID: rower.id,
      mode: 'distance',
      params: { meters: 2000 },
      ageMinutes: 30,
    })

    await page.goto('/')

    const card = page.getByTestId('stale-open-recovery-card')
    await expect(card).toBeVisible({ timeout: 10_000 })

    await expect(card.getByTestId('stale-recovery-finalize')).toBeVisible()
    await expect(card.getByTestId('stale-recovery-discard')).toBeVisible()
    // Regression: non-race mode MUST still show the Rejoin button.
    const rejoin = card.getByTestId('stale-recovery-rejoin')
    await expect(rejoin, 'non-race stale-open must render the Rejoin button').toBeVisible()
    await expect(rejoin).toBeEnabled()

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/04-distance-stale-card-with-rejoin.png`,
    })

    const elapsedMs = Date.now() - startedAt
    test.info().annotations.push({
      type: 'wall-clock',
      description: `non-race regression: ${(elapsedMs / 1000).toFixed(1)} s`,
    })
  })
})

function invokeCriticAdvisory(input: unknown): void {
  const which = spawnSync('which', ['claude'], { encoding: 'utf8' })
  if (which.status !== 0 || !which.stdout.trim()) {
    console.warn('[0019-05] claude CLI not on PATH — skipping e2e-critic advisory pass.')
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
    mkdirSync(SCREENSHOT_DIR, { recursive: true })
    writeFileSync(`${SCREENSHOT_DIR}/critic.json`, stdout || '{"findings": []}')
    if (stderr) writeFileSync(`${SCREENSHOT_DIR}/critic.stderr.txt`, stderr)
  } catch {
    /* best effort */
  }
  console.log(`[0019-05] e2e-critic exit=${result.status}; output → ${SCREENSHOT_DIR}/critic.json`)
}
