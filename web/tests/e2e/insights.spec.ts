import { spawnSync } from 'node:child_process'
import { test, expect } from './fixtures'
import { seedSessionSamples } from './helpers/seedSessionSamples'

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

  // Cards are the evidence layer (#40): label + key number, no sentence.
  await expect(cards.nth(0).getByTestId('finding-headline')).toHaveText('−6,8%')
  await expect(cards.nth(1).getByTestId('finding-headline')).toHaveText('1:59,6 → 2:03,2')
  await expect(cards.nth(0)).not.toContainText('Schlussabschnitt')

  // Synthesis paragraph: FADE + POSITIVE_SPLIT triggers em-dash join.
  await expect(
    page.locator('p').filter({
      hasText: /Leistungsabfall von 6,8% .* — Positiver Split: Zweite Hälfte/,
    }),
  ).toBeVisible()
})

// #40: on the 11.06.2026 5000 m session the Auswertung reads one short
// paragraph, then compact evidence cards (label, number, sparkline);
// no sentence appears twice. The pacing and consistency rows are what
// the detectors produce on the reconstructed fixture
// (insights/fixture_test.go); the drift row is seeded to exercise the
// card — with the two-sided pace condition the fixture does not fire it.
test('session insights: synthesis is the only prose, cards carry number + sparkline', async ({
  startBackend,
  seedActiveRower,
  home,
  history,
  page,
  waitForEndedSession,
}, testInfo) => {
  const handle = await startBackend({ fixture: FIXTURE_M3, idleTimeout: '20s', fixtureDelay: '4s' })
  const rower = await seedActiveRower()
  await home.open()
  await home.startFreeRow()
  const ended = await waitForEndedSession(rower.id, 30_000)
  seedSessionSamples(handle.dbPath, ended.id)

  const sql = [
    `DELETE FROM session_insights WHERE session_id = '${ended.id}';`,
    `INSERT INTO session_insights
       (rower_id, session_id, detector_id, code, severity, category, message_de, evidence_json, computed_at)
     VALUES
       ('${rower.id}', '${ended.id}', 'pacing', 'EVEN_SPLIT', 'INFO', 'PACING',
        'Gleichmäßiges Tempo über beide Hälften (1:47,8 / 1:46,6).',
        '{"h1":107.8,"h2":106.6,"delta":-1.2,"window_from":1,"window_to":104}', '2026-06-11T21:45:00Z'),
       ('${rower.id}', '${ended.id}', 'consistency', 'CONSISTENT_HIGH', 'INFO', 'CONSISTENCY',
        'Tempokonstanz: sehr gleichmäßig (Split-Variation 2,0%).',
        '{"cv":1.96,"mean":107.2,"std":2.1,"window_from":1,"window_to":104}', '2026-06-11T21:45:00Z'),
       ('${rower.id}', '${ended.id}', 'drift', 'EFFICIENCY_DRIFT', 'NOTABLE', 'EFFICIENCY',
        'Effizienzdrift: Schlaglänge von 9,97 auf 9,47 m gesunken, Schlagzahl von 27,5 auf 29,6 gestiegen.',
        '{"dps1":9.97,"dps2":9.47,"dps_pct":-5.07,"spm1":27.48,"spm2":29.6,"split1":107.7,"split2":105.6,"window_from":1,"window_to":104}',
        '2026-06-11T21:45:00Z');`,
  ].join('\n')
  const r = spawnSync('sqlite3', [handle.dbPath, sql], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`sqlite3 seed failed: ${r.stderr}`)

  await page.setViewportSize({ width: 390, height: 844 })
  await history.openSessions()
  await history.openFirstSession()
  const synthesis = page.getByTestId('insights-synthesis')
  const cards = page.getByTestId('finding-card')
  await cards.last().scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 200)) // clear the bottom nav
  await page.screenshot({ path: testInfo.outputPath('01-auswertung.png') })

  await expect(cards).toHaveCount(3)
  // Drift (NOTABLE) first; pacing before consistency when both are INFO.
  await expect(cards.nth(0)).toHaveAttribute('data-code', 'EFFICIENCY_DRIFT')
  await expect(cards.nth(1)).toHaveAttribute('data-category', 'PACING')
  await expect(cards.nth(2)).toHaveAttribute('data-category', 'CONSISTENCY')
  await expect(cards.nth(0).getByTestId('finding-headline')).toHaveText('DPS −5,0%')
  await expect(cards.nth(0)).toContainText('SPM 27,5 → 29,6')
  await expect(cards.nth(1).getByTestId('finding-headline')).toHaveText('1:47,8 / 1:46,6')
  await expect(cards.nth(2).getByTestId('finding-headline')).toHaveText('Variation 2,0%')
  await expect(synthesis).toContainText(/^Effizienzdrift: Schlaglänge von 9,97 auf 9,47 m gesunken/)

  // The synthesis is not a substring of any card, and no card repeats a sentence.
  const synthText = (await synthesis.textContent())!
  for (const body of await cards.allTextContents()) {
    expect(synthText).not.toContain(body)
    expect(body).not.toContain('Gleichmäßiges Tempo')
    expect(body).not.toContain('Split-Variation')
    expect(body).not.toContain('gesunken')
  }

  // Each card draws its sparkline, and stays within two text lines at 390 px.
  await expect(page.getByTestId('finding-sparkline')).toHaveCount(3)
  for (const box of await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
    expect(box).toBeLessThan(90)
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
