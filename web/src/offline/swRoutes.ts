/**
 * Which `GET /api` paths the Service Worker may serve from its runtime
 * cache when the backend is unreachable (Workbox `NetworkFirst`).
 *
 * This is the SW-layer mirror of `isPersistableQuery` (persistKeys.ts):
 * the read endpoints that back the offline trainer-demo — Verlauf
 * (trends), Rekorde (pbs/lifetime/achievements), session list + detail
 * (incl. samples / pb-banners), favorites, workout shapes — plus the
 * bootstrap (`rowers` / `active-rower`) that lets `RowerGate` pass
 * without a network round-trip.
 *
 * Everything else under `/api` stays `NetworkOnly`: mutations, the SSE
 * stream (`/api/v1/stream`), session control (`/api/v1/session/*`),
 * `stale-open`, `workouts/last`, and crucially `/api/health` — the
 * uncached reachability probe that tells the app whether the ergo is
 * actually reachable (see reachability.ts).
 *
 * NetworkFirst means the network always wins when it answers, so an
 * online user never sees stale data; the cache only serves when the
 * fetch fails. Staleness is then labelled in the app via the "Stand: …"
 * notice, driven off the reachability probe — not off query success.
 *
 * Hardening (ADR-0021):
 * - The SW gives up on the network after `SW_NETWORK_TIMEOUT_SECONDS`;
 *   the client GET timeout (`GET_TIMEOUT_MS`, api/error.ts) must outlast
 *   it by a margin, or a hanging connection aborts the page fetch before
 *   the SW serves its cache (epic #1, B1).
 * - A 5xx (`isServerFailureStatus`) counts as a network failure, so
 *   Caddy's 502 (Pi up, service down) falls back to the cache (B3).
 *   Only ≥ 500: a 403 (pairing required) or 404 must reach the page, or
 *   an unpaired device would see another rower's stale data.
 * - The bootstrap reads (`isBootstrapPath`) live in their own SW route
 *   without expiration, so RowerGate's data never ages out or gets
 *   LRU-evicted by samples.
 *
 * Kept in sync with the inline `urlPattern`s / plugin in vite.config.ts,
 * which must be self-contained so Workbox can inline them into the SW.
 */

/** Seconds the SW `NetworkFirst` waits for the network before serving
 *  its cache. Imported by vite.config.ts at config time. */
export const SW_NETWORK_TIMEOUT_SECONDS = 4

/** The reads that let `RowerGate` pass — cached without expiration. */
export function isBootstrapPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '')
  return p === '/api/v1/rowers' || p === '/api/v1/active-rower'
}

/** Responses the SW treats as a failed fetch (→ cache fallback). */
export function isServerFailureStatus(status: number): boolean {
  return status >= 500
}

export function isOfflineReadPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '')
  if (
    p === '/api/v1/rowers' ||
    p === '/api/v1/active-rower' ||
    p === '/api/v1/favorites' ||
    p === '/api/v1/sessions' // session list
  ) {
    return true
  }

  const s = p.split('/').filter(Boolean) // e.g. ['api','v1','rowers',':id','pbs']

  // /api/v1/rowers/:id/(pbs|lifetime|achievements|trends)
  if (s[0] === 'api' && s[1] === 'v1' && s[2] === 'rowers' && s.length === 5) {
    return s[4] === 'pbs' || s[4] === 'lifetime' || s[4] === 'achievements' || s[4] === 'trends'
  }

  // /api/v1/sessions/:id and /api/v1/sessions/:id/(samples|pb-banners)
  if (s[0] === 'api' && s[1] === 'v1' && s[2] === 'sessions') {
    if (s[3] === 'stale-open') return false
    if (s.length === 4) return true
    if (s.length === 5) return s[4] === 'samples' || s[4] === 'pb-banners'
    return false
  }

  // /api/v1/workouts/:id — but not the live `workouts/last` lookup
  if (s[0] === 'api' && s[1] === 'v1' && s[2] === 'workouts' && s.length === 4) {
    return s[3] !== 'last'
  }

  return false
}
