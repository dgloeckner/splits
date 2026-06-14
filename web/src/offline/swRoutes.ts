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
 * Kept in sync with the inline `urlPattern` in vite.config.ts, which
 * must be self-contained so Workbox can inline it into the generated SW.
 */
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
