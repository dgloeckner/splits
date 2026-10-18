import { useMemo, type ReactNode } from 'react'
import { EventSourceChannel, type Channel } from './channel'
import { useEventSource } from './useEventSource'
import { LiveSessionContext, type LiveSession } from './LiveSessionContext'

type Props = {
  children: ReactNode
  /** Optional injection point for tests. Defaults to EventSourceChannel. */
  channel?: Channel
}

export function LiveSessionProvider({ children, channel }: Props) {
  const resolved = useMemo(() => channel ?? new EventSourceChannel(), [channel])
  const { state, dispatch } = useEventSource(resolved)
  const value = useMemo<LiveSession>(
    () => ({ ...state, reconnect: () => resolved.reconnect?.(), dispatch }),
    [state, resolved, dispatch],
  )
  return <LiveSessionContext.Provider value={value}>{children}</LiveSessionContext.Provider>
}
