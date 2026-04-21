import type {
  LiveEvent,
  SessionStartPayload,
  StrokePayload,
  SessionEndSummary,
} from './events'
import type { ChannelStatus } from './channel'
import { ema } from './ema'
import { smoothingConfig } from './smoothing'

const SPARKLINE_WINDOW_SEC = smoothingConfig.sparkline.windowSeconds.phone

export type SparklinePoint = { time_sec: number; value: number }

export type SmoothedValues = {
  power: number | null
  paceSecPer500m: number | null
  spm: number | null
  dps: number | null
  spi: number | null
}

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
  smoothed: SmoothedValues | null
  /** Wall-clock ms at first stroke after session_start. Used to gate cold-start. */
  sessionStartedAtMs: number | null
}

export const initialLiveState: LiveState = {
  status: 'idle',
  session: null,
  stroke: null,
  summary: null,
  sparklines: { power: [], split: [], dps: [], spm: [] },
  lastStrokeReceivedAtMs: null,
  smoothed: null,
  sessionStartedAtMs: null,
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

function computeSpi(p: StrokePayload): number | null {
  if (p.spm === 0 || p.power_w < 20) return null
  return p.power_w / p.spm
}

function nextSmoothed(
  prev: SmoothedValues | null,
  p: StrokePayload,
  inColdStart: boolean,
): SmoothedValues {
  const rawSpi = computeSpi(p)

  if (inColdStart || prev === null) {
    return {
      power: p.power_w,
      paceSecPer500m: p.pace_sec_per_500m,
      spm: p.spm,
      dps: p.dps,
      spi: rawSpi,
    }
  }

  return {
    power: ema(prev.power, p.power_w, smoothingConfig.ema.watts.alpha),
    paceSecPer500m: ema(
      prev.paceSecPer500m,
      p.pace_sec_per_500m,
      smoothingConfig.ema.split.alpha,
    ),
    spm: ema(prev.spm, p.spm, smoothingConfig.ema.spm.alpha),
    dps: ema(prev.dps, p.dps, smoothingConfig.ema.dps.alpha),
    spi:
      rawSpi === null
        ? prev.spi
        : ema(prev.spi, rawSpi, smoothingConfig.ema.spi.alpha),
  }
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
            smoothed: null,
            sessionStartedAtMs: null,
          }

        case 'stroke': {
          const p = ev.data
          const appendOrTrim = (series: SparklinePoint[], value: number) => {
            const next = [...series, { time_sec: p.time_sec, value }]
            return trimWindow(next, p.time_sec)
          }
          const now = Date.now()
          const sessionStartedAtMs = state.sessionStartedAtMs ?? now
          const inColdStart =
            now - sessionStartedAtMs < smoothingConfig.coldStartSeconds * 1000
          const smoothed = nextSmoothed(state.smoothed, p, inColdStart)
          return {
            ...state,
            stroke: p,
            sparklines: {
              power: appendOrTrim(state.sparklines.power, p.power_w),
              split: appendOrTrim(state.sparklines.split, p.pace_sec_per_500m),
              dps: appendOrTrim(state.sparklines.dps, p.dps),
              spm: appendOrTrim(state.sparklines.spm, p.spm),
            },
            lastStrokeReceivedAtMs: now,
            sessionStartedAtMs,
            smoothed,
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
