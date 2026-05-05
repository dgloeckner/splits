import { apiFetch } from './error'

export type RaceOpponent = {
  sourceSessionId: string
  label: 'ghost' | 'pb'
  tSec: number[]
  split: number[]
}

export type RaceOpponentsResponse = {
  ghost: RaceOpponent | null
  pb: RaceOpponent | null
}

type WireRaceOpponent = {
  source_session_id: string
  label: 'ghost' | 'pb'
  t_sec: number[]
  split: number[]
}

type WireRaceOpponentsResponse = {
  ghost: WireRaceOpponent | null
  pb: WireRaceOpponent | null
}

function mapOpponent(w: WireRaceOpponent | null): RaceOpponent | null {
  if (w == null) return null
  return {
    sourceSessionId: w.source_session_id,
    label: w.label,
    tSec: w.t_sec ?? [],
    split: w.split ?? [],
  }
}

export async function fetchRaceOpponents(params: {
  workoutId: string
  rowerId: string
}): Promise<RaceOpponentsResponse> {
  const qs = new URLSearchParams({
    workout_id: params.workoutId,
    rower_id: params.rowerId,
  }).toString()
  const r = await apiFetch(`/api/v1/race/opponents?${qs}`)
  if (!r.ok) throw new Error(`race opponents fetch failed: ${r.status}`)
  const w = (await r.json()) as WireRaceOpponentsResponse
  return {
    ghost: mapOpponent(w.ghost),
    pb: mapOpponent(w.pb),
  }
}
