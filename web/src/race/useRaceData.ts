import { useEffect, useState } from 'react'
import { fetchRaceOpponents, type RaceOpponentsResponse } from '../api/raceOpponents'

const empty: RaceOpponentsResponse = { ghost: null, pb: null }

function readSelection(): { ghost: boolean; pb: boolean } {
  try {
    const raw = sessionStorage.getItem('race-opp-selection')
    if (!raw) return { ghost: true, pb: true }
    return JSON.parse(raw) as { ghost: boolean; pb: boolean }
  } catch {
    return { ghost: true, pb: true }
  }
}

export function useRaceData(args: { workoutId: string | null; rowerId: string | null }): RaceOpponentsResponse {
  const [state, setState] = useState<RaceOpponentsResponse>(empty)

  useEffect(() => {
    if (!args.workoutId || !args.rowerId) {
      setState(empty)
      return
    }
    let cancelled = false
    fetchRaceOpponents({ workoutId: args.workoutId, rowerId: args.rowerId })
      .then((r) => {
        if (cancelled) return
        const sel = readSelection()
        setState({
          ghost: sel.ghost ? r.ghost : null,
          pb: sel.pb ? r.pb : null,
        })
      })
      .catch(() => { if (!cancelled) setState(empty) })
    return () => { cancelled = true }
  }, [args.workoutId, args.rowerId])

  return state
}
