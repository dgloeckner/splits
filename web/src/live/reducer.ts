import type {
  LiveEvent,
  SessionStartPayload,
  StrokePayload,
  SessionEndSummary,
} from './events'
import type { ChannelStatus } from './channel'

const SPARKLINE_WINDOW_SEC = 60

export type SparklinePoint = { time_sec: number; value: number }

export type LiveState = {
  status: ChannelStatus
  session: SessionStartPayload | null
  stroke: StrokePayload | null
  summary: SessionEndSummary | null
  sparklines: {
    power: SparklinePoint[]
    split: SparklinePoint[]
    dps: SparklinePoint[]
    spm: SparklinePoint[]
  }
  lastStrokeReceivedAtMs: number | null
}

export const initialLiveState: LiveState = {
  status: 'idle',
  session: null,
  stroke: null,
  summary: null,
  sparklines: { power: [], split: [], dps: [], spm: [] },
  lastStrokeReceivedAtMs: null,
}

export type LiveAction =
  | { type: 'status'; status: ChannelStatus }
  | { type: 'event'; event: LiveEvent }
  | { type: 'tick'; nowMs: number }

function trimWindow(points: SparklinePoint[], now: number): SparklinePoint[] {
  const cutoff = now - SPARKLINE_WINDOW_SEC
  let i = 0
  while (i < points.length && points[i].time_sec < cutoff) i++
  return i === 0 ? points : points.slice(i)
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'status':
      if (state.status === action.status) return state
      return { ...state, status: action.status }

    case 'tick':
      return state

    case 'event': {
      const ev = action.event
      switch (ev.kind) {
        case 'ping':
        case 'error':
          return state

        case 'eof':
          return { ...state, stroke: null }

        case 'session_start':
          return {
            ...state,
            session: ev.data,
            stroke: null,
            summary: null,
            sparklines: { power: [], split: [], dps: [], spm: [] },
            lastStrokeReceivedAtMs: null,
          }

        case 'stroke': {
          const p = ev.data
          const appendOrTrim = (series: SparklinePoint[], value: number) => {
            const next = [...series, { time_sec: p.time_sec, value }]
            return trimWindow(next, p.time_sec)
          }
          return {
            ...state,
            stroke: p,
            sparklines: {
              power: appendOrTrim(state.sparklines.power, p.power_w),
              split: appendOrTrim(state.sparklines.split, p.pace_sec_per_500m),
              dps: appendOrTrim(state.sparklines.dps, p.dps),
              spm: appendOrTrim(state.sparklines.spm, p.spm),
            },
            lastStrokeReceivedAtMs: Date.now(),
          }
        }

        case 'session_end':
          return {
            ...state,
            stroke: null,
            summary: ev.data.summary,
          }

        case 'level_change':
          return state
      }
    }
  }
}
