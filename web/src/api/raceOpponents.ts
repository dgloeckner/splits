import { apiFetch } from './error'

export type RaceOpponentKind = 'session' | 'synth'

export type RaceOpponent = {
  kind: RaceOpponentKind
  sourceSessionId?: string
  label: 'ghost' | 'pb'
  tSec: number[]
  split: number[]
}

export type RaceOpponentsResponse = {
  ghost: RaceOpponent | null
  pb: RaceOpponent | null
}

type WireOpponent = {
  kind: 'session' | 'synth'
  source_session_id?: string
  label: 'ghost' | 'pb'
  t_sec: number[]
  split: number[]
}

export async function fetchRaceOpponents(args: {
  workoutId: string
  rowerId: string
}): Promise<RaceOpponentsResponse> {
  const url = `/api/v1/workouts/${encodeURIComponent(args.workoutId)}/opponents` +
    `?rower_id=${encodeURIComponent(args.rowerId)}`
  const r = await apiFetch(url)
  if (!r.ok) throw new Error(`race opponents fetch failed: ${r.status}`)
  const w = (await r.json()) as { ghost: WireOpponent | null; pb: WireOpponent | null }
  const map = (o: WireOpponent | null): RaceOpponent | null => o ? {
    kind: o.kind,
    sourceSessionId: o.source_session_id,
    label: o.label,
    tSec: o.t_sec ?? [],
    split: o.split ?? [],
  } : null
  return { ghost: map(w.ghost), pb: map(w.pb) }
}
