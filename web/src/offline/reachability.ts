import { setErgoStatus } from './ergoStatus'

/**
 * Reachability probe for the ergo backend.
 *
 * Once the Service Worker serves `/api/*` reads from its runtime cache
 * (NetworkFirst, see swRoutes.ts), query *success* no longer means the
 * backend is reachable — a cached response is a success too. So the
 * "are we at home / is the ergo reachable" signal can no longer be
 * inferred from react-query; it needs its own uncached round-trip.
 *
 * `/api/health` is deliberately left `NetworkOnly` in the SW, so a
 * `no-store` fetch to it fails fast (or times out) exactly when the
 * backend is unreachable. That boolean drives `ergoStatus.reachable`,
 * which gates the offline hero, dimmed start affordances, and the
 * "Stand: …" label.
 */
const HEALTH_URL = '/api/health'
const PROBE_TIMEOUT_MS = 6_000

export async function probeReachable(): Promise<boolean> {
  try {
    const r = await fetch(HEALTH_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return r.ok
  } catch {
    return false
  }
}

let started = false

/**
 * Probe once on boot, then re-probe whenever the tab becomes visible or
 * the browser reports it is back online. Idempotent.
 */
export function startReachabilityProbe(): void {
  if (started) return
  started = true

  const run = () => {
    void probeReachable().then((reachable) => setErgoStatus({ reachable }))
  }

  run()

  if (typeof window !== 'undefined') {
    window.addEventListener('online', run)
    window.addEventListener('offline', () => setErgoStatus({ reachable: false }))
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') run()
    })
  }
}

export function _resetReachabilityForTest(): void {
  started = false
}
