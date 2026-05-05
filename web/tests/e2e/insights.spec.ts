import { spawnSync } from 'node:child_process'
import { test, expect } from './fixtures'

const FIXTURE_M3 = '../specs/int/fixtures/ipm/session-m3-long.csv'

test.describe.configure({ mode: 'serial' }) // shares port 8080
test.setTimeout(60_000)

// Browser-level e2e for FEAT-0011 Session Insights:
// rudert eine echte Fixture-Session, navigiert in History → Detail,
// und prüft die "Auswertung"-Sektion. Die m3-long Fixture (1027 m,
// 281 s) liegt unter dem 5min/1km Eligibility-Gate, daher zeigt das
// UI den "Session zu kurz"-Platzhalter — voller End-to-End-Pfad
// durch persister.applySessionEnd → /api/v1/sessions/{id}/insights →
// React InsightsSection.
test('session insights: too-short fixture renders placeholder via UI', async ({
  startBackend,
  seedActiveRower,
  home,
  history,
  page,
  waitForEndedSession,
}) => {
  await startBackend({
    fixture: FIXTURE_M3,
    idleTimeout: '20s',
    fixtureDelay: '4s',
  })
  const rower = await seedActiveRower()

  await home.open()
  await home.startFreeRow()

  await waitForEndedSession(rower.id, 30_000)

  await history.openSessions()
  await history.openFirstSession()

  const auswertung = page.getByRole('heading', { name: /Auswertung/i })
  await expect(auswertung).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Session zu kurz für Auswertung/i)).toBeVisible()
  await expect(page.getByTestId('finding-card')).toHaveCount(0)
})

// Eligible-session rendering: m3-long replay produces a real session
// that the gate marks too_short. We then patch the SQLite directly
// to (a) extend the session past the eligibility threshold and
// (b) insert two synthetic findings, exercising the InsightsSection
// happy-path (synthesis paragraph + severity-coloured cards) without
// needing a >5 min fixture.
test('session insights: eligible session renders cards + synthesis', async ({
  startBackend,
  seedActiveRower,
  home,
  history,
  page,
  waitForEndedSession,
}) => {
  const handle = await startBackend({
    fixture: FIXTURE_M3,
    idleTimeout: '20s',
    fixtureDelay: '4s',
  })
  const rower = await seedActiveRower()

  await home.open()
  await home.startFreeRow()
  const ended = await waitForEndedSession(rower.id, 30_000)

  // Bump the just-ended session past the eligibility gate and seed
  // two findings. SQLite is in WAL mode, so concurrent writes from
  // this CLI alongside the running backend are safe.
  const sql = [
    `UPDATE sessions
       SET total_time_sec = 600,
           total_distance_m = 2480
     WHERE id = '${ended.id}';`,
    `DELETE FROM session_insights WHERE session_id = '${ended.id}';`,
    `INSERT INTO session_insights
       (rower_id, session_id, detector_id, code, severity, category, message_de, evidence_json, computed_at)
     VALUES
       ('${rower.id}', '${ended.id}', 'fade', 'FADE', 'ATTENTION', 'EFFICIENCY',
        'Leistungsabfall von 6,8% im Schlussabschnitt (200W Schnitt → 187W).',
        '{"avg":200,"final":187,"pct":6.8}', '2026-05-05T20:00:00Z'),
       ('${rower.id}', '${ended.id}', 'pacing', 'POSITIVE_SPLIT', 'NOTABLE', 'PACING',
        'Positiver Split: Zweite Hälfte im Schnitt 3,6s langsamer als die erste (1:59,6 → 2:03,2).',
        '{"h1":119.6,"h2":123.2,"delta":3.6}', '2026-05-05T20:00:00Z');`,
  ].join('\n')

  const r = spawnSync('sqlite3', [handle.dbPath, sql], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`sqlite3 seed failed: ${r.stderr}`)
  }

  await history.openSessions()
  await history.openFirstSession()

  await expect(page.getByRole('heading', { name: /Auswertung/i })).toBeVisible({
    timeout: 10_000,
  })

  // Two cards, severity-sorted (ATTENTION first via Store ordering).
  const cards = page.getByTestId('finding-card')
  await expect(cards).toHaveCount(2)
  await expect(cards.nth(0)).toHaveAttribute('data-severity', 'ATTENTION')
  await expect(cards.nth(1)).toHaveAttribute('data-severity', 'NOTABLE')

  // Card-body content (both detector messages render in their own card).
  await expect(
    cards.nth(0).getByText(/Leistungsabfall von 6,8%/),
  ).toBeVisible()
  await expect(
    cards.nth(1).getByText(/Positiver Split: Zweite Hälfte/),
  ).toBeVisible()

  // Synthesis paragraph: FADE + POSITIVE_SPLIT triggers em-dash join.
  await expect(
    page.locator('p').filter({
      hasText: /Leistungsabfall von 6,8% .* — Positiver Split: Zweite Hälfte/,
    }),
  ).toBeVisible()
})
