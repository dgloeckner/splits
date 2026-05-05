import { createContext, useContext } from 'react'
import type { RaceOpponentsResponse } from '../api/race'

// Default empty value: `RaceTileAdapter` treats this as "no provider in
// scope" and falls back to its own `useRaceOpponents` hook (keeps
// standalone tests working without wrapping in a provider).
const empty: RaceOpponentsResponse = { ghost: null, pb: null }

export const RaceOpponentsContext = createContext<RaceOpponentsResponse>(empty)

export function useSharedRaceOpponents(): RaceOpponentsResponse {
  return useContext(RaceOpponentsContext)
}
