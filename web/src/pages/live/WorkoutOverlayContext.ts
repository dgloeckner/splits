import { createContext, useContext } from 'react'

export type WorkoutOverlay = {
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
export const WorkoutOverlayContext = createContext<WorkoutOverlay | null>(null)

export function useWorkoutOverlay(): WorkoutOverlay {
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
