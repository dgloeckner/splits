import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

type Ctx = { aborted: boolean; abort: () => void; reset: () => void }
const WorkoutOverlayContext = createContext<Ctx | null>(null)

export function WorkoutOverlayProvider({ children }: { children: ReactNode }) {
  const [aborted, setAborted] = useState(false)
  const value = useMemo<Ctx>(
    () => ({
      aborted,
      abort: () => setAborted(true),
      reset: () => setAborted(false),
    }),
    [aborted],
  )
  return <WorkoutOverlayContext.Provider value={value}>{children}</WorkoutOverlayContext.Provider>
}

export function useWorkoutOverlay(): Ctx {
  const ctx = useContext(WorkoutOverlayContext)
  if (!ctx) return { aborted: false, abort: () => {}, reset: () => {} }
  return ctx
}
