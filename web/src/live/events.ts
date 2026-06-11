// Wire types for the /api/v1/stream SSE endpoint. See
// specs/int/0002-live-stream-sse.md.

export type LiveEventKind =
  | 'stroke'
  | 'session_start'
  | 'session_end'
  | 'session_finalized'
  | 'level_change'
  | 'workout_attached'
  | 'phase_change'
  | 'session_paused'
  | 'session_resumed'
  | 'device'
  | 'ping'
  | 'eof'
  | 'error'

export type StrokePayload = {
  session_id: string
  stroke: number
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
  phase?: string
}

export type SessionStartPayload = {
  session_id: string
  started_at: string
  rower_id: string
  rower_name: string
  initial_level: number
  workout_id?: string
}

export type SessionSamples = {
  bucket_strokes: number
  t_sec: number[]
  split: number[]
  watt: number[]
  spm: number[]
  dps: number[]
  spi: number[]
}

export type RaceResultBlock = {
  vs_pb_sec: number | null
  vs_ghost_sec: number | null
  ghost_kind: 'session' | 'synth'
  opponent_session_ids?: string[]
}

export type SessionEndSummary = {
  total_distance_m: number
  total_time_sec: number
  total_strokes: number
  avg_power_w: number
  peak_power_w: number
  avg_spm: number
  avg_dps: number
  avg_pace_sec_per_500m: number
  session_calories: number
  samples?: SessionSamples
  race?: RaceResultBlock
}

export type SessionEndPayload = {
  session_id: string
  ended_at: string
  summary: SessionEndSummary
}

// Emitted by the persister AFTER session_end's SQLite txn commits, so
// fields the sessionizer can't compute synchronously (race, samples,
// pb_candidates) are present. The reducer replaces state.summary when
// session_id matches. PRD-0017 / 0017-03.
export type SessionFinalizedPayload = {
  session_id: string
  summary: SessionEndSummary
}

export type LevelChangePayload = {
  from: number
  to: number
  at_stroke: number
  at_time_sec: number
}

export type EofPayload = { session_id: string }

export type DevicePayload = {
  connected: boolean
  port?: string
  last_error?: string
  last_seen_at?: string
}

export type WorkoutAttachedPayload = {
  session_id: string
  workout_id: string
}

export type PhaseChangePayload = {
  session_id: string
  from: string
  to: string
  at_stroke: number
  at_time_sec: number
  at_distance_m: number
}

export type SessionPausePayload = {
  session_id: string
  at_time_sec: number
}

export type LiveEvent =
  | { kind: 'stroke'; id: number; data: StrokePayload }
  | { kind: 'session_start'; id: number; data: SessionStartPayload }
  | { kind: 'session_end'; id: number; data: SessionEndPayload }
  | { kind: 'session_finalized'; id: number; data: SessionFinalizedPayload }
  | { kind: 'level_change'; id: number; data: LevelChangePayload }
  | { kind: 'workout_attached'; id: number; data: WorkoutAttachedPayload }
  | { kind: 'phase_change'; id: number; data: PhaseChangePayload }
  | { kind: 'session_paused'; id: number; data: SessionPausePayload }
  | { kind: 'session_resumed'; id: number; data: SessionPausePayload }
  | { kind: 'device'; id: number | null; data: DevicePayload }
  | { kind: 'ping'; id: number | null; data: Record<string, never> }
  | { kind: 'eof'; id: number | null; data: EofPayload }
  | { kind: 'error'; id: number | null; data: { message: string } }
