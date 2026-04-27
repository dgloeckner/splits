export type SessionSummary = {
  total_distance_m: number
  total_time_sec: number
  total_strokes: number
  avg_power_w: number
  peak_power_w: number
  avg_spm: number
  avg_dps: number
  avg_spi: number
  avg_pace_sec_per_500m: number
  session_calories: number
}

export type SessionRow = {
  id: string
  rower_id: string
  workout_id?: string
  started_at: string
  ended_at?: string
  initial_level: number
  total_distance_m?: number
  total_time_sec?: number
  total_strokes?: number
  summary?: SessionSummary
  has_pb?: boolean
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
  spi: number
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

export async function endSession(): Promise<void> {
  const r = await fetch('/api/v1/session/end', { method: 'POST' })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
}

// startSession opens a new session on the backend with an optional
// workout id. Idempotent on the server: if a session is already open
// and not idle, the call is a no-op. Strokes arriving before this is
// called are dropped at the sessionizer (per FEAT-0009 / new-workout
// flow), so the UI must always call this before navigating to /live.
export async function startSession(workoutID?: string): Promise<void> {
  const r = await fetch('/api/v1/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workout_id: workoutID ?? '' }),
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
}

export type ActiveSession = {
  session_id: string
  started_at: string
  rower_id: string
  rower_name: string
  workout_id: string
  last_event_id: number
}

export async function getActiveSession(): Promise<ActiveSession | null> {
  const r = await fetch('/api/v1/session/active')
  if (r.status === 204) return null
  return json<ActiveSession>(r)
}

export type DistancePB = {
  distance_m: number
  time_sec: number
  previous_time_sec?: number
  source_session_id: string
  source_session_started_at: string
  achieved_at: string
}

export type WindowPB = {
  metric: string
  window_kind: string
  window_size: number
  value: number
  previous_value?: number
  source_session_id: string
  source_session_started_at: string
  achieved_at: string
}

export type SessionPBBanners = {
  distance: DistancePB[]
  window: WindowPB[]
}

export async function getSessionPBBanners(id: string): Promise<SessionPBBanners> {
  const r = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}/pb-banners`)
  return json<SessionPBBanners>(r)
}

export type TrendsRange = 'week' | 'month' | 'year' | 'all'

export type TrendsTotals = {
  distance_m: number
  active_sec: number
  sessions: number
}

export type TrendsResponse = {
  range: TrendsRange
  period: { label: string; from: string; to: string }
  totals: TrendsTotals
  prior?: TrendsTotals
  performance: {
    points: { t: string; avg_power_w: number; avg_pace_sec_per_500m: number }[]
    avg_power_w: number
    avg_pace_sec_per_500m: number
  }
  efficiency: {
    points: { t: string; avg_dps: number; avg_spi: number }[]
    avg_dps: number
    avg_spi: number
    delta_dps: number
    delta_spi: number
  }
  stats_version: number
}

export async function getRowerTrends(rowerID: string, range: TrendsRange): Promise<TrendsResponse> {
  const r = await fetch(
    `/api/v1/rowers/${encodeURIComponent(rowerID)}/trends?range=${range}`,
  )
  return json<TrendsResponse>(r)
}

// statsVersion is read from the X-Stats-Version response header. Used
// by the post-session-end UI to detect when the asynchronous PB
// recompute has completed.
export function statsVersionFrom(r: Response): number {
  const h = r.headers.get('X-Stats-Version')
  return h ? Number(h) : 0
}

export type WorkoutPB = {
  shape_hash: string
  mode: string
  params: Record<string, unknown>
  value_kind: 'time_sec' | 'distance_m'
  value: number
  previous_value?: number
  source_session_id: string
  source_session_started_at: string
  achieved_at: string
}

export type RowerPBs = {
  distance: DistancePB[]
  window: WindowPB[]
  workout: WorkoutPB[]
}

export async function getRowerPBs(rowerID: string): Promise<RowerPBs> {
  const r = await fetch(`/api/v1/rowers/${encodeURIComponent(rowerID)}/pbs`)
  return json<RowerPBs>(r)
}

export type RowerLifetime = {
  total_distance_m: number
  total_active_sec: number
  total_strokes: number
  total_sessions: number
  stats_version: number
  computed_at?: string
}

export async function getRowerLifetime(rowerID: string): Promise<RowerLifetime> {
  const r = await fetch(`/api/v1/rowers/${encodeURIComponent(rowerID)}/lifetime`)
  return json<RowerLifetime>(r)
}

export type Achievement = {
  type: string
  key: string
  value?: number
  source_session_id?: string
  source_session_started_at?: string
  achieved_at: string
}

export async function getRowerAchievements(rowerID: string): Promise<Achievement[]> {
  const r = await fetch(`/api/v1/rowers/${encodeURIComponent(rowerID)}/achievements`)
  const body = await json<{ achievements: Achievement[] }>(r)
  return body.achievements
}
