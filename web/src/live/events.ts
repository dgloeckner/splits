// Wire types for the /api/v1/stream SSE endpoint. See
// specs/int/0002-live-stream-sse.md.

export type LiveEventKind =
  | 'stroke'
  | 'session_start'
  | 'session_end'
  | 'level_change'
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
}

export type SessionStartPayload = {
  session_id: string
  started_at: string
  rower_id: string
  rower_name: string
  initial_level: number
  workout_id?: string
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
}

export type SessionEndPayload = {
  session_id: string
  ended_at: string
  summary: SessionEndSummary
}

export type LevelChangePayload = {
  from: number
  to: number
  at_stroke: number
  at_time_sec: number
}

export type EofPayload = { session_id: string }

export type LiveEvent =
  | { kind: 'stroke'; id: number; data: StrokePayload }
  | { kind: 'session_start'; id: number; data: SessionStartPayload }
  | { kind: 'session_end'; id: number; data: SessionEndPayload }
  | { kind: 'level_change'; id: number; data: LevelChangePayload }
  | { kind: 'ping'; id: number | null; data: Record<string, never> }
  | { kind: 'eof'; id: number | null; data: EofPayload }
  | { kind: 'error'; id: number | null; data: { message: string } }
