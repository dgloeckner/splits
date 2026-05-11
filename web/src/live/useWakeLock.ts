import { useEffect, useRef } from 'react'

// useWakeLock: requests `navigator.wakeLock.request('screen')` while
// `active === true` and re-requests on `visibilitychange` when the page
// becomes visible again. Failures (denied, unsupported, hidden tab) are
// logged and otherwise non-blocking — phone-sleep recovery is handled
// by `endSessionQueue`.
//
// FEAT-0015 Slice 2 / ADR-0010.
//
// Note: WakeLockSentinel is auto-released by the browser when the
// document becomes hidden; that is why we re-request on every
// `visible` transition.

// Narrow shape; the lib.dom typings declare `navigator.wakeLock` but it
// is missing from some TS target configurations.
type WakeLockSentinelLike = {
  release: () => Promise<void>
  released?: boolean
}
type WakeLockApi = {
  request: (kind: 'screen') => Promise<WakeLockSentinelLike>
}

function getWakeLockApi(): WakeLockApi | null {
  if (typeof navigator === 'undefined') return null
  const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock
  return api ?? null
}

export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false

    const acquire = async () => {
      const api = getWakeLockApi()
      if (!api) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return
      }
      try {
        const sentinel = await api.request('screen')
        if (cancelled) {
          await sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
      } catch (err) {
        // Log but do not surface — wake lock is best-effort.
        console.warn('[useWakeLock] request failed', err)
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void acquire()
      }
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      const s = sentinelRef.current
      sentinelRef.current = null
      if (s) {
        s.release().catch(() => {})
      }
    }
  }, [active])
}
