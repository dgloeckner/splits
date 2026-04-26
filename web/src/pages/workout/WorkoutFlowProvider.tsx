import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react'

export type FlowMode = 'distance' | 'time' | 'intervals'
export type FlowIntensity = 'locker' | 'moderat' | 'hart' | 'allout'
export type IntervalLength = { unit: 'm' | 'min'; value: number }
export type IntervalsParams = { reps: number; length: IntervalLength; rest_sec: number }

export type FlowStep = 1 | 2 | 3 | 'confirm'

export type FlowState = {
  step: FlowStep
  mode?: FlowMode
  distanceMeters?: number
  timeSeconds?: number
  intervals?: IntervalsParams
  intensity?: FlowIntensity
  warmupEnabled: boolean
  warmupSec: number
  cooldownEnabled: boolean
  cooldownSec: number
  saveAsFavorite: boolean
  favoriteName: string
}

export type FlowAction =
  | { type: 'SELECT_MODE'; mode: FlowMode }
  | { type: 'SET_DISTANCE'; meters: number }
  | { type: 'SET_TIME'; seconds: number }
  | { type: 'SET_INTERVALS'; intervals: IntervalsParams }
  | { type: 'SET_INTENSITY'; intensity: FlowIntensity }
  | { type: 'TOGGLE_WARMUP' }
  | { type: 'SET_WARMUP_SEC'; seconds: number }
  | { type: 'TOGGLE_COOLDOWN' }
  | { type: 'SET_COOLDOWN_SEC'; seconds: number }
  | { type: 'TOGGLE_SAVE_FAVORITE' }
  | { type: 'SET_FAVORITE_NAME'; name: string }
  | { type: 'GO_BACK' }
  | { type: 'GO_TO_STEP3' }
  | { type: 'GO_TO_CONFIRM' }
  | { type: 'RESET' }

const baseInitial: FlowState = {
  step: 1,
  warmupEnabled: true,
  warmupSec: 300,
  cooldownEnabled: true,
  cooldownSec: 300,
  saveAsFavorite: false,
  favoriteName: '',
}

function makeInitial(mode?: FlowMode): FlowState {
  if (!mode) return baseInitial
  return { ...baseInitial, step: 2, mode }
}

function reducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'SELECT_MODE':
      return { ...state, mode: action.mode, step: 2 }
    case 'SET_DISTANCE':
      return { ...state, distanceMeters: action.meters }
    case 'SET_TIME':
      return { ...state, timeSeconds: action.seconds }
    case 'SET_INTERVALS':
      return { ...state, intervals: action.intervals }
    case 'GO_TO_STEP3':
      return { ...state, step: 3 }
    case 'SET_INTENSITY':
      return { ...state, intensity: action.intensity }
    case 'GO_TO_CONFIRM':
      return { ...state, step: 'confirm' }
    case 'TOGGLE_WARMUP':
      return { ...state, warmupEnabled: !state.warmupEnabled }
    case 'SET_WARMUP_SEC':
      return { ...state, warmupSec: Math.max(0, Math.min(900, action.seconds)) }
    case 'TOGGLE_COOLDOWN':
      return { ...state, cooldownEnabled: !state.cooldownEnabled }
    case 'SET_COOLDOWN_SEC':
      return { ...state, cooldownSec: Math.max(0, Math.min(900, action.seconds)) }
    case 'TOGGLE_SAVE_FAVORITE':
      return { ...state, saveAsFavorite: !state.saveAsFavorite }
    case 'SET_FAVORITE_NAME':
      return { ...state, favoriteName: action.name }
    case 'GO_BACK':
      if (state.step === 'confirm') return { ...state, step: 3 }
      if (state.step === 3) return { ...state, step: 2 }
      if (state.step === 2) return { ...state, step: 1 }
      return state
    case 'RESET':
      return baseInitial
  }
}

type Ctx = { state: FlowState; dispatch: Dispatch<FlowAction> }
const FlowContext = createContext<Ctx | null>(null)

export function WorkoutFlowProvider({ mode, children }: { mode?: FlowMode; children: ReactNode }) {
  const init = useMemo(() => makeInitial(mode), [mode])
  const [state, dispatch] = useReducer(reducer, init)
  return <FlowContext.Provider value={{ state, dispatch }}>{children}</FlowContext.Provider>
}

export function useWorkoutFlow(): Ctx {
  const ctx = useContext(FlowContext)
  if (!ctx) throw new Error('useWorkoutFlow must be used inside WorkoutFlowProvider')
  return ctx
}
