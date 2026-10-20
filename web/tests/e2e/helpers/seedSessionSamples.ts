import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The real 11.06.2026 5000 m session (#36, #46): bucket-level samples
 * with a 2:45 start bucket, a 1:46–1:50 body and an analysis window
 * [1, 105). Shared with the Go detector tests.
 */
export const FIXTURE_5000M = fileURLToPath(
  new URL('../../../../backend/internal/insights/testdata/2026-06-11-5000m.json', import.meta.url),
)

/** Session totals of the 11.06.2026 session, as the hero panel shows them. */
export const TOTALS_5000M = {
  total_distance_m: 5006,
  total_time_sec: 1087,
  total_strokes: 524,
  avg_pace_sec_per_500m: 108,
  avg_spm: 28.6,
  avg_power_w: 378,
  avg_dps: 9.55,
}

/**
 * Overwrite an ended session's summary samples and totals with a
 * samples fixture, so the detail page renders a long, realistic session
 * from a short fixture replay. WAL mode makes the concurrent write safe
 * (same pattern as insights.spec.ts).
 */
export function seedSessionSamples(dbPath: string, sessionId: string, fixturePath = FIXTURE_5000M): void {
  const fx = JSON.parse(readFileSync(fixturePath, 'utf8')) as { samples: unknown }
  const summary = JSON.stringify({ samples: fx.samples }).replaceAll("'", "''")
  const t = TOTALS_5000M
  const sql = `UPDATE sessions SET
      summary_json = '${summary}',
      total_distance_m = ${t.total_distance_m}, total_time_sec = ${t.total_time_sec},
      total_strokes = ${t.total_strokes}, avg_pace_sec_per_500m = ${t.avg_pace_sec_per_500m},
      avg_spm = ${t.avg_spm}, avg_power_w = ${t.avg_power_w}, avg_dps = ${t.avg_dps}
    WHERE id = '${sessionId}';`
  const r = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`sqlite3 seed failed: ${r.stderr}`)
}
