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
  /** Integer per live stroke; for an ended session a bucket mean with one decimal. */
  spm: number
  power_w: number
  cal_per_hr: number
  level: number
  dps: number
  stroke_cycle_sec: number
  pace_sec_per_500m: number
  energy_joules: number
}

import { ApiError, apiFetch, getFetch } from './error'

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`)
  return (await r.json()) as T
}

export async function listSessions(
  rowerID: string,
  limit = 50,
  offset = 0,
): Promise<SessionRow[]> {
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    rower_id: rowerID,
  })
  const r = await fetch(`/api/v1/sessions?${qs.toString()}`)
  const body = await json<{ sessions: SessionRow[] }>(r)
  return body.sessions
}

export async function getSession(id: string): Promise<SessionRow> {
  const r = await getFetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
  return json<SessionRow>(r)
}

/**
 * Analysis window (FEAT-0011 §Analysefenster): half-open bucket range
 * [from, to) into `samples` — the piece without its start-up bucket and
 * the strokes after the goal. Absent for sessions finalised before it
 * existed, and for live sessions.
 */
export type SamplesWindow = { from: number; to: number }

export type SessionSamples = {
  samples: Sample[]
  window: SamplesWindow | null
}

export async function getSamples(id: string): Promise<SessionSamples> {
  const r = await getFetch(`/api/v1/sessions/${encodeURIComponent(id)}/samples`)
  const body = await json<{ samples: Sample[]; window?: SamplesWindow }>(r)
  return { samples: body.samples, window: body.window ?? null }
}

/** The analysis window as a time range over the samples, for the charts. */
export function windowTimeRange(s: SessionSamples): { fromX: number; toX: number } | null {
  const w = s.window
  if (!w || w.from < 0 || w.to > s.samples.length || w.from >= w.to) return null
  return { fromX: s.samples[w.from].time_sec, toX: s.samples[w.to - 1].time_sec }
}

export async function deleteSession(id: string): Promise<void> {
  const r = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`)
}

// StaleOpenSession is one row in the resume-card list.
// FEAT-0015 Slice 3.
export type StaleOpenSession = {
  id: string
  started_at: string
  last_stroke_at: string
  total_distance_m: number
  workout_id?: string
  // mode is the workout mode of the attached workout (if any).
  // Used by the recovery card to hide "rejoin live" for race rows
  // per ADR-0012 (race-mode non-resumable).
  mode?: string
}

export async function listStaleOpenSessions(rowerID: string): Promise<StaleOpenSession[]> {
  const qs = new URLSearchParams({ rower_id: rowerID })
  const r = await fetch(`/api/v1/sessions/stale-open?${qs.toString()}`)
  const body = await json<{ sessions: StaleOpenSession[] }>(r)
  return body.sessions
}

// finalizeSession synthesises session_end on a stale-open session using
// the last stroke as ended_at. 204 on success; idempotent server-side.
export async function finalizeSession(id: string): Promise<void> {
  const r = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}/finalize`, { method: 'POST' })
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`)
}

export async function endSession(): Promise<void> {
  const r = await apiFetch('/api/v1/session/end', { method: 'POST' })
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`)
}

// raceGo signals the GO! moment of a race so the backend re-latches
// work anchors and excludes pre-GO strokes from totals and PB candidates
// (§Falschstart). Fire-and-forget — always resolves.
export async function raceGo(): Promise<void> {
  await fetch('/api/v1/session/race-go', { method: 'POST' })
}

// startSession opens a new session on the backend with an optional
// workout id. Idempotent on the server: if a session is already open
// and not idle, the call is a no-op. Strokes arriving before this is
// called are dropped at the sessionizer (per FEAT-0009 / new-workout
// flow), so the UI must always call this before navigating to /live.
// Fails fast (6s) instead of hanging when the ergo is unreachable —
// callers surface that as a toast rather than a dead button.
export async function startSession(workoutID?: string): Promise<void> {
  const r = await apiFetch('/api/v1/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workout_id: workoutID ?? '' }),
    signal: AbortSignal.timeout(6_000),
  })
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`)
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
  const r = await getFetch(`/api/v1/sessions/${encodeURIComponent(id)}/pb-banners`)
  return json<SessionPBBanners>(r)
}

export type TrendsWindowKey = '30d' | '365d' | 'all'

export type TrendsTotals = {
  distance_m: number
  active_sec: number
  sessions: number
}

export type TrendsPoint = {
  t: string
  session_id: string
  mode: string
  shape_hash?: string
  distance_m: number
  time_sec: number
  avg_pace_sec_per_500m: number
  avg_power_w: number
  avg_spm: number
  avg_dps: number
  completed: boolean
  distance_pb: boolean
}

export type TrendsResponse = {
  window: TrendsWindowKey
  from: string
  to: string
  points: TrendsPoint[]
  series: TrendsSeries[]
  totals: TrendsTotals
  prior?: TrendsTotals
  stats_version: number
}

export type TrendsSeriesKey = {
  shape_hash: string
}

export type TrendsSeriesPoint = {
  t: string
  session_id: string
  total_distance_m: number
  total_time_sec: number
  avg_power_w: number
  avg_pace_sec_per_500m: number
  avg_dps: number
  avg_spm: number
}

export type TrendsSeries = {
  key: TrendsSeriesKey
  params: unknown
  display_name: string
  pb_pace_sec_per_500m?: number
  points: TrendsSeriesPoint[]
}

export async function getRowerTrends(rowerID: string, window: TrendsWindowKey): Promise<TrendsResponse> {
  const r = await getFetch(
    `/api/v1/rowers/${encodeURIComponent(rowerID)}/trends?window=${window}`,
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
  const r = await getFetch(`/api/v1/rowers/${encodeURIComponent(rowerID)}/pbs`)
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
  const r = await getFetch(`/api/v1/rowers/${encodeURIComponent(rowerID)}/lifetime`)
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
  const r = await getFetch(`/api/v1/rowers/${encodeURIComponent(rowerID)}/achievements`)
  const body = await json<{ achievements: Achievement[] }>(r)
  return body.achievements
}
