export type SessionSummary = {
  total_distance_m: number
  total_time_sec: number
  total_strokes: number
  avg_power_w: number
  peak_power_w: number
  avg_spm: number
  avg_dps: number
  avg_pace_sec_per_500m: number
  session_calories: number
}

export type SessionRow = {
  id: string
  rower_id: string
  started_at: string
  ended_at?: string
  initial_level: number
  total_distance_m?: number
  total_time_sec?: number
  total_strokes?: number
  summary?: SessionSummary
}

export type Sample = {
  stroke_no: number
  time_sec: number
  distance_m: number
  spm: number
  power_w: number
  cal_per_hr: number
  level: number
  dps: number
  stroke_cycle_sec: number
  pace_sec_per_500m: number
  energy_joules: number
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return (await r.json()) as T
}

export async function listSessions(limit = 50, offset = 0): Promise<SessionRow[]> {
  const r = await fetch(`/api/v1/sessions?limit=${limit}&offset=${offset}`)
  const body = await json<{ sessions: SessionRow[] }>(r)
  return body.sessions
}

export async function getSession(id: string): Promise<SessionRow> {
  const r = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
  return json<SessionRow>(r)
}

export async function getSamples(id: string): Promise<Sample[]> {
  const r = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}/samples`)
  const body = await json<{ samples: Sample[] }>(r)
  return body.samples
}

export async function deleteSession(id: string): Promise<void> {
  const r = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
}
