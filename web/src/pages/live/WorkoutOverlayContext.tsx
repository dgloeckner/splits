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

type Ctx = { aborted: boolean; abort: () => void; reset: () => void }
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

  const value = useMemo<Ctx>(() => ({ aborted, abort, reset }), [aborted, abort, reset])
  return <WorkoutOverlayContext.Provider value={value}>{children}</WorkoutOverlayContext.Provider>
}

export function useWorkoutOverlay(): Ctx {
  const ctx = useContext(WorkoutOverlayContext)
  if (!ctx) return { aborted: false, abort: () => {}, reset: () => {} }
  return ctx
}
