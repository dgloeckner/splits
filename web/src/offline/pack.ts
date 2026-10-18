import type { QueryClient } from '@tanstack/react-query'
import {
  getRowerAchievements,
  getRowerLifetime,
  getRowerPBs,
  getRowerTrends,
  getSamples,
  getSession,
  type RowerLifetime,
  type SessionRow,
  type TrendsResponse,
} from '../api/client'
import { getActiveRower } from '../api/rowers'
import { getWorkout } from '../api/workouts'
import { loadCursor, saveCursor } from './cursor'
import { getErgoStatus, setErgoStatus, subscribeErgoStatus } from './ergoStatus'
import { PERSIST_SCHEMA_VERSION } from './persister'

export const OFFLINE_SESSION_DEPTH = 10
export const PACK_GUARD_MS = 15 * 60_000
const FULL_PACK_MAX_AGE_MS = 24 * 60 * 60_000

let inFlight = false
let lastProbeOkAt = 0
let triggersRegistered = false
let unsubscribeStatus: (() => void) | null = null

export function _resetPackForTest(): void {
  inFlight = false
  lastProbeOkAt = 0
  triggersRegistered = false
  unsubscribeStatus?.()
  unsubscribeStatus = null
}

export async function packIfStale(qc: QueryClient): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const cursor = await loadCursor()
    if (cursor) {
      setErgoStatus({ packedAt: cursor.packedAt, packedSessions: cursor.sessionIds.length })
    }
    // Only pack against a confirmed-reachable Ergo: away from home every
    // read below succeeds from the SW cache, and a "pack" would stamp a
    // fresh Stand on stale data. registerPackTriggers re-runs us once
    // the probe confirms.
    if (getErgoStatus().reachable !== true) return

    let rid: string
    let lifetime: RowerLifetime
    try {
      const rower = await qc.fetchQuery({
        queryKey: ['active-rower'],
        queryFn: getActiveRower,
        staleTime: 10_000,
        retry: false,
      })
      if (!rower) return
      rid = rower.id
      lifetime = await qc.fetchQuery({
        queryKey: ['rower-lifetime', rid],
        queryFn: () => getRowerLifetime(rid),
        staleTime: 0,
        retry: false,
      })
    } catch {
      // Reachability is owned by the /api/health probe (ADR-0019), not
      // by this fetch — under NetworkFirst the read could be served
      // from the SW cache and would wrongly report "reachable".
      return
    }
    lastProbeOkAt = Date.now()

    const fresh =
      cursor !== null &&
      cursor.rowerId === rid &&
      cursor.statsVersion === lifetime.stats_version &&
      cursor.schemaVersion === PERSIST_SCHEMA_VERSION &&
      Date.now() - Date.parse(cursor.packedAt) < FULL_PACK_MAX_AGE_MS
    if (fresh) return

    const trendsAll = await qc.fetchQuery<TrendsResponse>({
      queryKey: ['rower-trends', rid, 'all'],
      queryFn: () => getRowerTrends(rid, 'all'),
      staleTime: 0,
      retry: false,
    })
    for (const w of ['30d', '365d'] as const) {
      await qc.fetchQuery({
        queryKey: ['rower-trends', rid, w],
        queryFn: () => getRowerTrends(rid, w),
        staleTime: 0,
        retry: false,
      })
    }
    await qc.fetchQuery({
      queryKey: ['rower-pbs', rid],
      queryFn: () => getRowerPBs(rid),
      staleTime: 0,
      retry: false,
    })
    await qc.fetchQuery({
      queryKey: ['rower-achievements', rid],
      queryFn: () => getRowerAchievements(rid),
      staleTime: 0,
      retry: false,
    })

    const ids = [...trendsAll.points]
      .sort((a, b) => (a.t < b.t ? 1 : -1))
      .slice(0, OFFLINE_SESSION_DEPTH)
      .map((p) => p.session_id)

    for (const id of ids) {
      const s = await qc.fetchQuery<SessionRow>({
        queryKey: ['sessions', id],
        queryFn: () => getSession(id),
        staleTime: Infinity,
        retry: false,
      })
      await qc.fetchQuery({
        queryKey: ['sessions', id, 'samples'],
        queryFn: () => getSamples(id),
        staleTime: Infinity,
        retry: false,
      })
      if (s.workout_id) {
        const wid = s.workout_id
        await qc.fetchQuery({
          queryKey: ['workout', wid],
          queryFn: () => getWorkout(wid),
          staleTime: Infinity,
          retry: false,
        })
      }
    }

    pruneOutsideKeepSet(qc, rid, ids)

    const packedAt = new Date().toISOString()
    await saveCursor({
      rowerId: rid,
      statsVersion: lifetime.stats_version,
      schemaVersion: PERSIST_SCHEMA_VERSION,
      packedAt,
      sessionIds: ids,
    })
    setErgoStatus({ packedAt, packedSessions: ids.length })
  } catch {
    // No cursor write on failure — the next trigger retries.
  } finally {
    inFlight = false
  }
}

const ROWER_SCOPED = new Set([
  'rower-trends',
  'rower-pbs',
  'rower-achievements',
  'rower-lifetime',
  'favorites',
])

function pruneOutsideKeepSet(qc: QueryClient, rowerId: string, keepIds: string[]): void {
  const keep = new Set(keepIds)
  const keptWorkouts = new Set<string>()
  for (const id of keepIds) {
    const s = qc.getQueryData<SessionRow>(['sessions', id])
    if (s?.workout_id) keptWorkouts.add(s.workout_id)
  }
  qc.removeQueries({
    type: 'all',
    predicate: (q) => {
      const [k0, k1] = q.queryKey
      return (
        (k0 === 'sessions' && typeof k1 === 'string' && k1 !== 'stale-open' && !keep.has(k1)) ||
        (k0 === 'workout' && typeof k1 === 'string' && !keptWorkouts.has(k1)) ||
        (typeof k0 === 'string' && ROWER_SCOPED.has(k0) && k1 !== rowerId)
      )
    },
  })
}

export function onAppVisible(qc: QueryClient): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  if (Date.now() - lastProbeOkAt < PACK_GUARD_MS) return
  void packIfStale(qc)
}

export function registerPackTriggers(qc: QueryClient): void {
  if (triggersRegistered) return
  triggersRegistered = true
  // Safari has no requestIdleCallback, although lib.dom declares it.
  const w = window as Omit<Window, 'requestIdleCallback'> & {
    requestIdleCallback?: Window['requestIdleCallback']
  }
  const idle = (fn: () => void) =>
    w.requestIdleCallback ? w.requestIdleCallback(fn) : w.setTimeout(fn, 1500)
  idle(() => void packIfStale(qc))
  document.addEventListener('visibilitychange', () => onAppVisible(qc))
  // The boot's idle trigger usually beats the first probe: pack as soon
  // as the Ergo is confirmed reachable (unknown/false → true).
  let wasReachable = getErgoStatus().reachable === true
  unsubscribeStatus = subscribeErgoStatus(() => {
    const now = getErgoStatus().reachable === true
    if (now && !wasReachable) void packIfStale(qc)
    wasReachable = now
  })
}
