import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * Seed a stale-open session directly via the sqlite3 CLI so the
 * recovery-card surface lights up on Home for the given rower.
 *
 * The production stale-open lifecycle is: sessionizer opens a session
 * row, strokes arrive, the connection dies, the 1-minute janitor sweep
 * notices `MAX(strokes.at)` is older than the 5-minute threshold, and
 * flips `status='stale-open'`. There is no test-only "time-travel"
 * endpoint, but the same final DB shape is reachable directly:
 * INSERT a workout, a session row with `ended_at IS NULL` +
 * `status='stale-open'`, and one stroke whose `at` is well in the
 * past. This mirrors the manipulation pattern already in use in
 * `insights.spec.ts`.
 *
 * The backend is in WAL mode, so concurrent writes from this CLI
 * alongside the running splits process are safe.
 */
export type SeedStaleOpenOpts = {
  /** Filesystem path to the splits backend's SQLite DB. */
  dbPath: string
  /** Rower id the seeded session belongs to. */
  rowerID: string
  /** Workout mode for the attached workout row. */
  mode: 'race' | 'distance' | 'time' | 'intervals' | 'just_row'
  /** Params encoded as workout.params_json. Defaults to `{}`. */
  params?: Record<string, unknown>
  /**
   * How far in the past to put the most recent stroke timestamp.
   * Defaults to 30 minutes — comfortably past the 5-minute staleness
   * threshold.
   */
  ageMinutes?: number
}

export type SeedStaleOpenResult = {
  sessionID: string
  workoutID: string
}

export function seedStaleOpenSession(opts: SeedStaleOpenOpts): SeedStaleOpenResult {
  const sessionID = randomUUID()
  const workoutID = randomUUID()
  const ageMinutes = opts.ageMinutes ?? 30
  const now = Date.now()
  // Stroke and session both anchored to the same well-past instant
  // so MAX(strokes.at) is unambiguously past the staleness threshold.
  const lastStrokeAt = new Date(now - ageMinutes * 60 * 1000).toISOString()
  const startedAt = new Date(now - (ageMinutes + 5) * 60 * 1000).toISOString()
  const paramsJson = JSON.stringify(opts.params ?? {}).replace(/'/g, "''")
  const createdAt = startedAt

  // strokes.global_id is INTEGER PRIMARY KEY (rowid). Use a value
  // unlikely to collide with anything the sessionizer is writing in
  // parallel: high bits seeded from current time.
  const globalID = Math.floor(now)

  const sql = [
    `INSERT INTO workout (id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at)
     VALUES ('${workoutID}', '${opts.mode}', '${paramsJson}', 'moderat', 0, 0, '${createdAt}');`,
    // status='stale-open' set directly: faster than running the janitor
    // sweep and the observable shape is identical.
    `INSERT INTO sessions (id, rower_id, started_at, ended_at, initial_level, total_distance_m, workout_id, status)
     VALUES ('${sessionID}', '${opts.rowerID}', '${startedAt}', NULL, 3, 250, '${workoutID}', 'stale-open');`,
    `INSERT INTO strokes (global_id, session_id, stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level, dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules, at)
     VALUES (${globalID}, '${sessionID}', 1, 60, 250, 24, 180, 900, 3, 5.2, 2.5, 120, 600, '${lastStrokeAt}');`,
  ].join('\n')

  const r = spawnSync('sqlite3', [opts.dbPath, sql], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(
      `seedStaleOpenSession: sqlite3 exit=${r.status} stderr=${r.stderr} stdout=${r.stdout}`,
    )
  }
  return { sessionID, workoutID }
}
