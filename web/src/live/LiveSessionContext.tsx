import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { EventSourceChannel, type Channel } from './channel'
import { useEventSource } from './useEventSource'
import type { LiveState } from './reducer'

const LiveSessionContext = createContext<LiveState | null>(null)

type Props = {
  children: ReactNode
  /** Optional injection point for tests. Defaults to EventSourceChannel. */
  channel?: Channel
}

export function LiveSessionProvider({ children, channel }: Props) {
  const resolved = useMemo(() => channel ?? new EventSourceChannel(), [channel])
  const state = useEventSource(resolved)
  return <LiveSessionContext.Provider value={state}>{children}</LiveSessionContext.Provider>
}

export function useLiveSession(): LiveState {
  const v = useContext(LiveSessionContext)
  if (!v) throw new Error('useLiveSession must be used inside <LiveSessionProvider>')
  return v
}
