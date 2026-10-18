import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLiveSession } from '../../live/LiveSessionContext'

type Ctx = {
  aborted: boolean
  abort: () => void
  reset: () => void
  /** Record that this session is being discarded, BEFORE the delete is
   *  awaited, so LivePage suppresses the session-end latch (no
   *  save-overlay for a discard). */
  markDiscarded: (sessionId: string) => void
  /** True if the given session id was marked discarded. */
  wasDiscarded: (sessionId: string | null) => boolean
}
const WorkoutOverlayContext = createContext<Ctx | null>(null)

export function WorkoutOverlayProvider({ children }: { children: ReactNode }) {
  const state = useLiveSession()
  const sessionId = state.session?.session_id ?? null
  const [aborted, setAborted] = useState(false)
  // session_id captured at the moment abort() was called. Used to
  // auto-clear `aborted` once a *different* session is opened, so a
  // subsequent workout starts with a clean overlay even if the user
  // never navigates back to /live in between.
  const abortedSessionId = useRef<string | null>(null)
  const discardedSessionId = useRef<string | null>(null)

  useEffect(() => {
    if (aborted && sessionId && sessionId !== abortedSessionId.current) {
      setAborted(false)
      abortedSessionId.current = null
    }
  }, [aborted, sessionId])

  const abort = useCallback(() => {
    abortedSessionId.current = sessionId
    setAborted(true)
  }, [sessionId])

  const reset = useCallback(() => {
    setAborted(false)
    abortedSessionId.current = null
  }, [])

  const markDiscarded = useCallback((sid: string) => {
    discardedSessionId.current = sid
  }, [])

  const wasDiscarded = useCallback(
    (sid: string | null) => sid !== null && discardedSessionId.current === sid,
    [],
  )

  const value = useMemo<Ctx>(
    () => ({ aborted, abort, reset, markDiscarded, wasDiscarded }),
    [aborted, abort, reset, markDiscarded, wasDiscarded],
  )
  return <WorkoutOverlayContext.Provider value={value}>{children}</WorkoutOverlayContext.Provider>
}

export function useWorkoutOverlay(): Ctx {
  const ctx = useContext(WorkoutOverlayContext)
  if (!ctx)
    return {
      aborted: false,
      abort: () => {},
      reset: () => {},
      markDiscarded: () => {},
      wasDiscarded: () => false,
    }
  return ctx
}
