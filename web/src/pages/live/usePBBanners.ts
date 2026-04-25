import { useEffect, useState } from 'react'
import { getSessionPBBanners, type SessionPBBanners } from '../../api/client'

export type BannerState =
  | { kind: 'idle' }
  | { kind: 'computing' }
  | { kind: 'resolved'; banners: SessionPBBanners }
  | { kind: 'timeout' }

// usePBBanners polls /sessions/{id}/pb-banners after session_end with
// short backoff (250 ms → 500 ms → 1 s, max 5 s) until the response
// indicates the recompute landed (X-Stats-Version increment OR a
// banner exists). Falls back to `timeout` after 10 s; UI treats that
// as resolved-no-PB.
//
// Pass `null` while the session is still open; the hook stays in
// `idle` and does no work.
export function usePBBanners(sessionId: string | null): BannerState {
  const [state, setState] = useState<BannerState>({ kind: 'idle' })

  useEffect(() => {
    if (!sessionId) {
      setState({ kind: 'idle' })
      return
    }
    setState({ kind: 'computing' })

    let cancelled = false
    const startedAt = Date.now()
    const delays = [250, 500, 1000, 1000, 1500, 2000, 2000]
    let i = 0

    async function poll() {
      if (cancelled) return
      try {
        const banners = await getSessionPBBanners(sessionId!)
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

  return state
}
