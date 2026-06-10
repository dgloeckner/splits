import { useEffect, useRef } from 'react'
import { useLiveSession } from './LiveSessionContext'
import { getSession as defaultGetSession, type SessionRow } from '../api/client'
import { ApiError } from '../api/error'
import type { SessionEndSummary } from './events'

/**
 * Project the BE's persisted SessionRow.summary into the live reducer's
 * SessionEndSummary shape. SessionRow.summary carries `avg_spi` (which
 * the live shape doesn't track) and lacks the optional `samples` / `race`
 * blocks — those land via the `session_finalized` SSE event when the
 * rower opens the session. Returning `null` when no summary is present
 * keeps the reducer behaviour identical to the no-payload path.
 */
function projectSummary(row: SessionRow): SessionEndSummary | null {
  const s = row.summary
  if (!s) return null
  return {
    total_distance_m: s.total_distance_m,
    total_time_sec: s.total_time_sec,
    total_strokes: s.total_strokes,
    avg_power_w: s.avg_power_w,
    peak_power_w: s.peak_power_w,
    avg_spm: s.avg_spm,
    avg_dps: s.avg_dps,
    avg_pace_sec_per_500m: s.avg_pace_sec_per_500m,
    session_calories: s.session_calories,
  }
}

export type UseBootReconcileDeps = {
  /** Injection seam for tests. Defaults to the real API helper. */
  getSession?: (id: string) => Promise<SessionRow>
}

/**
 * Boot-time session reconciliation hook.
 *
 * PRD-0019 / CONTEXT §Boot-time session reconciliation:
 * `LiveSessionContext` hydrates from `sessionStorage` on cold boot
 * (see `useEventSource.hydrate`). The cached state may carry an
 * "active workout" snapshot — `session.workout_id` set and `summary
 * === null` — for a session the backend has already finalised
 * (unclean shutdown / app-kill mid-cooldown). `BottomNav.workoutActive`
 * keys off exactly that derivation, so without reconciliation all
 * three tabs read as locked indefinitely.
 *
 * This hook runs **exactly once** at app boot. It asks the backend
 * whether the cached `session_id` is ended, open, or unknown:
 *
 * - BE returns `ended_at` set → drop the cached state (`reset`
 *   action). Nav unlocks naturally.
 * - BE returns `ended_at IS NULL` and the cached row matches → keep
 *   the cache so the §Stale-open recovery flow can run.
 * - BE returns 404 / no record → drop the cache silently.
 *
 * Network / non-404 errors are intentionally ignored: we'd rather
 * leave the cached state alone (and let the user retry) than wipe it
 * because the backend is briefly unreachable.
 */
export function useBootReconcile(deps: UseBootReconcileDeps = {}): void {
  const { dispatch, session } = useLiveSession()
  const getSession = deps.getSession ?? defaultGetSession
  const cachedSessionId = session?.session_id ?? null

  // Latch the boot-time cached id and run reconciliation against
  // exactly that id, once. Subsequent context changes (a new session
  // starting, sparkline updates, etc.) must not retrigger.
  const ran = useRef(false)
  const bootSessionIdRef = useRef<string | null>(cachedSessionId)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const bootId = bootSessionIdRef.current
    if (!bootId) return // nothing cached → nothing to reconcile
    let cancelled = false
    void (async () => {
      try {
        const row = await getSession(bootId)
        if (cancelled) return
        if (row.ended_at) {
          dispatch?.({ type: 'reset', summary: projectSummary(row) })
        }
        // else: ended_at IS NULL → keep cache; stale-open flow handles it.
      } catch (e) {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 404) {
          dispatch?.({ type: 'reset' })
        }
        // network / 5xx: leave cache alone.
      }
    })()
    return () => {
      cancelled = true
      // Reset so the second StrictMode mount (dev double-effect) can
      // re-run reconciliation. In production there is no cleanup before
      // unmount so this is a no-op there.
      ran.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once at mount; intentionally no deps
}
