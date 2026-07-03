import { getErgoStatus, setErgoStatus } from './ergoStatus'

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
 *
 * Self-healing (ADR-0020): while unreachable, the probe re-runs every
 * REPROBE_WHILE_DOWN_MS, so a single mistimed probe (e.g. Wi-Fi still
 * re-associating right after unlock) cannot latch `reachable = false`
 * until the next visibility change. `retryReachabilityNow()` is the
 * manual trigger behind every "Erneut verbinden" button. On the
 * false→true transition exactly one `onReconnect` hook fires so query
 * invalidation, the end-session queue and the offline pack are
 * coordinated in one place (wired in main.tsx).
 */
const HEALTH_URL = '/api/health'
const PROBE_TIMEOUT_MS = 3_500
export const REPROBE_WHILE_DOWN_MS = 25_000

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
let probing = false
let downTimer: ReturnType<typeof setTimeout> | null = null
let onReconnect: (() => void) | null = null

async function runProbe(): Promise<void> {
  if (probing) return
  probing = true
  try {
    const reachable = await probeReachable()
    const wasReachable = getErgoStatus().reachable
    setErgoStatus({ reachable })
    if (reachable && !wasReachable) onReconnect?.()
  } finally {
    probing = false
    scheduleReprobeWhileDown()
  }
}

function scheduleReprobeWhileDown(): void {
  if (downTimer) {
    clearTimeout(downTimer)
    downTimer = null
  }
  if (getErgoStatus().reachable) return
  downTimer = setTimeout(() => {
    downTimer = null
    void runProbe()
  }, REPROBE_WHILE_DOWN_MS)
}

/**
 * Manual reconnect trigger — behind every "Erneut verbinden" button.
 * Runs a probe immediately; the onReconnect hook (if the probe
 * succeeds after a failure) does the rest.
 */
export function retryReachabilityNow(): void {
  void runProbe()
}

/**
 * Probe once on boot, then re-probe on visibility/online/pageshow and
 * on an interval while unreachable. Idempotent.
 */
export function startReachabilityProbe(opts?: { onReconnect?: () => void }): void {
  if (started) return
  started = true
  onReconnect = opts?.onReconnect ?? null

  void runProbe()

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void runProbe())
    window.addEventListener('offline', () => {
      setErgoStatus({ reachable: false })
      scheduleReprobeWhileDown()
    })
    // iOS standalone PWAs can resume from the bfcache without a
    // visibilitychange; pageshow covers that path.
    window.addEventListener('pageshow', () => void runProbe())
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void runProbe()
    })
  }
}

export function _resetReachabilityForTest(): void {
  started = false
  probing = false
  onReconnect = null
  if (downTimer) {
    clearTimeout(downTimer)
    downTimer = null
  }
}
