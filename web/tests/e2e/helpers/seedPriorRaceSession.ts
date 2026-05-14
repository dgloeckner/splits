import type { APIRequestContext } from '@playwright/test'

export type SeedPriorRaceOpts = {
  /** Race distance in meters; must be a standard race distance. */
  meters: number
  /** Optional intensity tag. Defaults to "moderat" since that's the
   *  intensity the canonical happy-path scenario uses. */
  intensity?: 'locker' | 'moderat' | 'hart' | 'allout'
}

/**
 * Seed a prior race-mode workout so that the opponent fetch
 * (`GET /api/v1/workouts/{id}/opponents`) for the under-test race has
 * something to return. Ideally this would also write a *completed*
 * session so the by-distance ghost + PB queries find a row, but the
 * backend has no API to ingest synthetic strokes — sessions are opened
 * by the sessionizer once strokes arrive from the IPM or the fixture
 * replayer. See "Known limitations" in 0016-05 happy-path.spec.ts.
 *
 * For now this helper guarantees the *workout* row exists and returns
 * its id. The actual session-with-strokes seeding is deferred to a
 * future enhancement (likely a `/test/seed-session` dev-mode endpoint
 * paralleling the resume endpoint from 0016-02).
 *
 * Returns the created workout id so the caller can chain follow-up
 * inserts when that endpoint lands.
 */
export async function seedPriorRaceSession(
  request: APIRequestContext,
  opts: SeedPriorRaceOpts,
): Promise<{ workoutId: string }> {
  const intensity = opts.intensity ?? 'moderat'
  const r = await request.post('/api/v1/workouts', {
    data: {
      mode: 'race',
      params: { meters: opts.meters },
      intensity,
      warmup_sec: 0,
      cooldown_sec: 0,
    },
  })
  if (!r.ok()) {
    throw new Error(`seedPriorRaceSession: POST /workouts -> ${r.status()}`)
  }
  const body = (await r.json()) as { id: string }
  return { workoutId: body.id }
}
