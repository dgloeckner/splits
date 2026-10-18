import { createContext, useContext, type Dispatch } from 'react'
import type { LiveState, LiveAction } from './reducer'

export type LiveSession = LiveState & {
  /**
   * Manually trigger a reconnect. Wired to the "Erneut verbinden"
   * banner button when the channel reaches `permanently_disconnected`.
   * Optional so test fixtures can mount the context with a plain
   * LiveState; ConnectionBanner falls back to a no-op.
   */
  reconnect?: () => void
  /**
   * Imperative dispatch into the live reducer. Used by
   * `useBootReconcile` to drop cached "active workout" state when the
   * backend says the cached session has already ended (PRD-0019 /
   * §Boot-time session reconciliation). Optional so test fixtures can
   * mount the context with a plain LiveState.
   */
  dispatch?: Dispatch<LiveAction>
}

export const LiveSessionContext = createContext<LiveSession | null>(null)

export function useLiveSession(): LiveSession {
  const v = useContext(LiveSessionContext)
  if (!v) throw new Error('useLiveSession must be used inside <LiveSessionProvider>')
  return v
}
