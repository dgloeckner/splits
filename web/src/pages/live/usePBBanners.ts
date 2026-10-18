import { useEffect, useState } from 'react'
import { getSessionPBBanners, type SessionPBBanners } from '../../api/client'

export type BannerState =
  | { kind: 'idle' }
  | { kind: 'computing' }
  | { kind: 'resolved'; banners: SessionPBBanners }
  | { kind: 'timeout' }

const IDLE: BannerState = { kind: 'idle' }
const COMPUTING: BannerState = { kind: 'computing' }

// usePBBanners polls /sessions/{id}/pb-banners after session_end with
// short backoff (250 ms → 500 ms → 1 s, max 5 s) until the response
// indicates the recompute landed (X-Stats-Version increment OR a
// banner exists). Falls back to `timeout` after 10 s; UI treats that
// as resolved-no-PB.
//
// Pass `null` while the session is still open; the hook stays in
// `idle` and does no work.
export function usePBBanners(sessionId: string | null): BannerState {
  // The outcome of the last poll, tagged with the session it belongs to: a
  // session without an outcome yet reads as `computing`.
  const [result, setResult] = useState<{ sessionId: string; state: BannerState } | null>(null)
  // Closing the session forgets the outcome, so reopening polls afresh.
  // Adjusted while rendering, React's pattern for state that follows a
  // changing input.
  if (!sessionId && result !== null) setResult(null)

  useEffect(() => {
    if (!sessionId) return
    const id = sessionId
    const setState = (state: BannerState) => setResult({ sessionId: id, state })

    let cancelled = false
    const startedAt = Date.now()
    const delays = [250, 500, 1000, 1000, 1500, 2000, 2000]
    let i = 0

    async function poll() {
      if (cancelled) return
      try {
        const banners = await getSessionPBBanners(id)
        if (cancelled) return
        const hasAny = banners.distance.length > 0 || banners.window.length > 0
        if (hasAny) {
          setState({ kind: 'resolved', banners })
          return
        }
      } catch {
        // ignore; will retry until timeout
      }
      if (Date.now() - startedAt > 10_000) {
        // 10 s budget. Treat "no banners" as resolved-no-PB; even if
        // the recompute is still running, the UI proceeds and the
        // user can come back to Session-Detail to see PBs later.
        setState({ kind: 'resolved', banners: { distance: [], window: [] } })
        return
      }
      const wait = delays[Math.min(i, delays.length - 1)]
      i++
      setTimeout(poll, wait)
    }
    void poll()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (!sessionId) return IDLE
  return result?.sessionId === sessionId ? result.state : COMPUTING
}
