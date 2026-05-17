import { useEffect, useReducer, useRef, type Dispatch } from 'react'
import type { Channel } from './channel'
import { liveReducer, initialLiveState, type LiveAction, type LiveState } from './reducer'

// Persist the reducer state in sessionStorage so a tab reload mid-
// session restores the live charts (split, watts, etc.) instead of
// resetting them to empty. The SSE replay only sends events newer
// than Last-Event-ID, so without this hydration the sparklines stay
// blank until enough new strokes arrive to refill the window.
//
// Scope: per-tab (sessionStorage), so opening a new tab starts fresh
// — matching the "this tab is the live view" mental model. We discard
// the snapshot if its `status` was `closed` (the previous mount tore
// down deliberately) so we don't restore stale charts after the user
// explicitly left the live page.
const STORAGE_KEY = 'splits:live-state'

function hydrate(): LiveState {
  if (typeof window === 'undefined') return initialLiveState
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return initialLiveState
    const parsed = JSON.parse(raw) as LiveState
    if (parsed.status === 'closed') return initialLiveState
    // Status will be re-driven by the channel on subscribe; reset it
    // so the UI starts in `connecting` rather than reporting a stale
    // `open` from the previous mount.
    return { ...parsed, status: 'idle' }
  } catch {
    return initialLiveState
  }
}

export type UseEventSourceResult = {
  state: LiveState
  dispatch: Dispatch<LiveAction>
}

export function useEventSource(channel: Channel): UseEventSourceResult {
  const [state, dispatch] = useReducer(liveReducer, undefined, hydrate)

  // Persist on every state change. The state object is small (a few
  // hundred sparkline points capped by the rolling window), so a
  // synchronous write per stroke is cheap. Skip during SSR.
  const skipFirstWrite = useRef(true)
  useEffect(() => {
    if (skipFirstWrite.current) {
      skipFirstWrite.current = false
      return
    }
    if (typeof window === 'undefined') return
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* quota or private mode — ignore */
    }
  }, [state])

  useEffect(() => {
    channel.subscribe({
      onEvent: (event) => dispatch({ type: 'event', event }),
      onStatus: (status) => dispatch({ type: 'status', status }),
    })
    return () => channel.close()
  }, [channel])

  return { state, dispatch }
}
