import { useEffect, useRef, useState } from 'react'
import { fetchRaceOpponents, type RaceOpponentsResponse } from '../api/race'

const empty: RaceOpponentsResponse = { ghost: null, pb: null }

export function useRaceOpponents(args: {
  workoutId: string | null
  rowerId: string | null
}): RaceOpponentsResponse {
  const [state, setState] = useState<RaceOpponentsResponse>(empty)
  const lockedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!args.workoutId || !args.rowerId) {
      setState(empty)
      lockedFor.current = null
      return
    }
    if (lockedFor.current === args.workoutId) return
    lockedFor.current = args.workoutId
    let cancelled = false
    const wid = args.workoutId
    const rid = args.rowerId
    fetchRaceOpponents({ workoutId: wid, rowerId: rid })
      .then((r) => {
        if (!cancelled) setState(r)
      })
      .catch(() => {
        if (!cancelled) setState(empty)
      })
    return () => {
      cancelled = true
    }
  }, [args.workoutId, args.rowerId])

  return state
}
