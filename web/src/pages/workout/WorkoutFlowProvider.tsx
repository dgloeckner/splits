import { useMemo, useReducer, type ReactNode } from 'react'
import {
  WorkoutFlowContext,
  makeInitialFlow,
  workoutFlowReducer,
  type FlowMode,
} from './WorkoutFlowContext'

export function WorkoutFlowProvider({ mode, children }: { mode?: FlowMode; children: ReactNode }) {
  const init = useMemo(() => makeInitialFlow(mode), [mode])
  const [state, dispatch] = useReducer(workoutFlowReducer, init)
  return <WorkoutFlowContext.Provider value={{ state, dispatch }}>{children}</WorkoutFlowContext.Provider>
}
