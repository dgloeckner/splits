import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { EventSourceChannel, type Channel } from './channel'
import { useEventSource } from './useEventSource'
import type { LiveState } from './reducer'

type LiveSession = LiveState & {
  /**
   * Manually trigger a reconnect. Wired to the "Erneut verbinden"
   * banner button when the channel reaches `permanently_disconnected`.
   * Optional so test fixtures can mount the context with a plain
   * LiveState; ConnectionBanner falls back to a no-op.
   */
  reconnect?: () => void
}

export const LiveSessionContext = createContext<LiveSession | null>(null)

type Props = {
  children: ReactNode
  /** Optional injection point for tests. Defaults to EventSourceChannel. */
  channel?: Channel
}

export function LiveSessionProvider({ children, channel }: Props) {
  const resolved = useMemo(() => channel ?? new EventSourceChannel(), [channel])
  const state = useEventSource(resolved)
  const value = useMemo<LiveSession>(
    () => ({ ...state, reconnect: () => resolved.reconnect?.() }),
    [state, resolved],
  )
  return <LiveSessionContext.Provider value={value}>{children}</LiveSessionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLiveSession(): LiveSession {
  const v = useContext(LiveSessionContext)
  if (!v) throw new Error('useLiveSession must be used inside <LiveSessionProvider>')
  return v
}
