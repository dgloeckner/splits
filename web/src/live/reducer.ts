import type {
  LiveEvent,
  SessionStartPayload,
  StrokePayload,
  SessionEndSummary,
} from './events'
import type { ChannelStatus } from './channel'
import { ema } from './ema'
import { smoothingConfig } from './smoothing'
import { PAUSE_GAP_MS, PLAUSIBLE, type PlausibilityKey } from './liveness'

const SPARKLINE_WINDOW_SEC = smoothingConfig.sparkline.windowSeconds.phone

// `value: null` marks a pause gap — renderers should break the line here
// rather than draw a fake interpolation across dead time.
export type SparklinePoint = { time_sec: number; value: number | null }

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
  phase: 'warmup' | 'work' | 'rest' | 'cooldown' | null
  /**
   * IPM serial connectivity, pushed via the `device` SSE event. `null`
   * = unknown (no event yet — assume connected so the UI doesn't flash
   * a yellow banner during initial load).
   */
  deviceConnected: boolean | null
  /** True while the device reports the session is paused (work clock stopped). */
  serverPaused: boolean
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
  phase: null,
  deviceConnected: null,
  serverPaused: false,
}

export type LiveAction =
  | { type: 'status'; status: ChannelStatus }
  /**
   * nowMs: wall-clock at event arrival, stamped by the dispatcher
   * (useEventSource). Optional for legacy callers/tests; the golden
   * replay harness (ADR-0017) always supplies it so the reducer is a
   * pure fold over the event list.
   */
  | { type: 'event'; event: LiveEvent; nowMs?: number }
  | { type: 'tick'; nowMs: number }
  // Boot-time reconciliation (PRD-0019 / §Boot-time session reconciliation):
  // imperatively drop the cached session/summary/sparklines when the BE
  // says the cached session is already ended (or unknown). Preserves only
  // the current channel `status` so the live SSE bind isn't disturbed.
  | { type: 'reset'; summary?: SessionEndSummary | null }

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

  // Pass-through for every metric the device emits directly: split-pace
  // (the rower's own smoothed value), watts/SPM/DPS (per-stroke values
  // the rower's LCD shows without further smoothing). Adding an EMA on
  // top introduced visible lag versus the LCD — the iPad would trail
  // the console's watt readout by 1–2 strokes on rapid changes — and
  // is inconsistent with the methodology adopted for split when we
  // started trusting the wire as ground truth.
  //
  // SPI keeps its EMA: it's derived (watts/spm) and inherits noise
  // from both inputs, so smoothing reduces stroke-to-stroke twitchiness
  // that doesn't reflect a real change in effort.
  //
  // The display-layer hysteresis (useLiveDisplay) continues to absorb
  // ±1 W / ±0.1 m / etc. wiggles so the rendered integer doesn't
  // flicker between effectively-identical strokes.
  return {
    power: p.power_w,
    paceSecPer500m: p.pace_sec_per_500m,
    spm: p.spm,
    dps: p.dps,
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

    case 'reset':
      // Preserve the channel status (the SSE bind is still live); wipe
      // everything else back to initial. Used by useBootReconcile when
      // the backend says the cached "active workout" no longer exists
      // or has already ended. When the BE returned a finalised
      // SessionRow, seed `summary` from it so downstream consumers
      // (Historie, RacePostScreen) can render without a re-fetch.
      return {
        ...initialLiveState,
        status: state.status,
        summary: action.summary ?? null,
      }

    case 'event': {
      const ev = action.event
      switch (ev.kind) {
        case 'ping':
        case 'error':
          return state

        case 'device':
          if (state.deviceConnected === ev.data.connected) return state
          return { ...state, deviceConnected: ev.data.connected }

        case 'eof':
          return { ...state, stroke: null }

        case 'session_start':
          // Snapshot replay after a reload re-emits the active
          // session's session_start with the same session_id. Treat
          // that as idempotent: refresh the session shell but keep
          // sparklines, smoothing, and phase anchors so the live
          // charts survive the reload. A genuinely new session
          // (different id) still wipes everything.
          // Implicit-stroke-created sessions leave rower_id empty;
          // we still want a real session_start to re-anchor them
          // (resets smoothed/sessionStartedAtMs). Only treat as
          // idempotent when the hydrated session has full payload.
          if (
            state.session?.session_id === ev.data.session_id &&
            state.session.rower_id
          ) {
            return { ...state, session: ev.data }
          }
          return {
            ...state,
            session: ev.data,
            stroke: null,
            summary: null,
            sparklines: { power: [], split: [], dps: [], spm: [] },
            lastStrokeReceivedAtMs: null,
            smoothed: null,
            sessionStartedAtMs: null,
            phase: null,
            serverPaused: false,
          }

        case 'stroke': {
          const p = ev.data
          const now = action.nowMs ?? Date.now()
          // If the stroke belongs to a session we haven't observed a
          // session_start for (e.g. SSE replayed past the start, or the
          // backend dropped the early events while we were latched on
          // the previous summary), treat the very first stroke for the
          // new session as an implicit start: clear sparklines and
          // summary so we render the new session, not the old one.
          const newSession = state.session?.session_id !== p.session_id
          const baseState: LiveState = newSession
            ? {
                ...state,
                session: state.session
                  ? {
                      ...state.session,
                      session_id: p.session_id,
                      // Clear workout_id: it belongs to the previous
                      // session and would otherwise keep BottomNav
                      // locked / strip rendering for a workout that
                      // is no longer active. The next workout_attached
                      // event will repopulate it.
                      workout_id: undefined,
                    }
                  : {
                      session_id: p.session_id,
                      started_at: new Date(now).toISOString(),
                      rower_id: '',
                      rower_name: '',
                      initial_level: p.level,
                    },
                summary: null,
                sparklines: { power: [], split: [], dps: [], spm: [] },
                lastStrokeReceivedAtMs: null,
                smoothed: null,
                sessionStartedAtMs: null,
                phase: null,
                serverPaused: false,
              }
            : state
          const prevMs = baseState.lastStrokeReceivedAtMs
          const resumedFromPause = prevMs !== null && now - prevMs > PAUSE_GAP_MS
          const appendOrTrim = (
            series: SparklinePoint[],
            value: number,
            key: PlausibilityKey,
          ) => {
            let next = series
            if (resumedFromPause) {
              // Nudge epsilon before the new point so the gap marker sorts
              // correctly with the new sample's time_sec.
              next = [...next, { time_sec: p.time_sec - 0.001, value: null }]
            }
            const r = PLAUSIBLE[key]
            if (Number.isFinite(value) && value >= r.min && value <= r.max) {
              next = [...next, { time_sec: p.time_sec, value }]
            }
            return trimWindow(next, p.time_sec)
          }
          const sessionStartedAtMs = baseState.sessionStartedAtMs ?? now
          const inColdStart =
            now - sessionStartedAtMs < smoothingConfig.coldStartSeconds * 1000
          const smoothed = nextSmoothed(baseState.smoothed, p, inColdStart)
          return {
            ...baseState,
            stroke: p,
            phase: (p.phase as LiveState['phase']) ?? baseState.phase,
            sparklines: {
              power: appendOrTrim(baseState.sparklines.power, p.power_w, 'watts'),
              split: appendOrTrim(baseState.sparklines.split, p.pace_sec_per_500m, 'split'),
              dps: appendOrTrim(baseState.sparklines.dps, p.dps, 'dps'),
              spm: appendOrTrim(baseState.sparklines.spm, p.spm, 'spm'),
            },
            lastStrokeReceivedAtMs: now,
            sessionStartedAtMs,
            smoothed,
          }
        }

        case 'session_end':
          // Guard against SSE redelivery of a previous session's end
          // (mirrors session_finalized): only apply when it matches
          // the session we're tracking. With no tracked session, apply
          // (cold reconnect catching up on a just-ended session).
          if (state.session && ev.data.session_id !== state.session.session_id) {
            return state
          }
          return {
            ...state,
            stroke: null,
            summary: ev.data.summary,
          }

        case 'session_finalized':
          // PRD-0017 / 0017-03: post-persist enriched summary. Replace
          // only when the payload's session_id matches the latched
          // session — events for a different (stale / restored)
          // session must not overwrite live state.
          if (ev.data.session_id !== state.session?.session_id) return state
          return { ...state, summary: ev.data.summary }

        case 'level_change':
          return state

        case 'workout_attached':
          if (!state.session) return state
          // Reset live charts + smoothing on attach: any sparkline points
          // and EMA values gathered during the pre-attach free-row prelude
          // belong to a different intent (no target band, no phase) and
          // would skew the work-phase y-axis until trimmed by the window.
          return {
            ...state,
            session: { ...state.session, workout_id: ev.data.workout_id },
            sparklines: { power: [], split: [], dps: [], spm: [] },
            smoothed: null,
          }

        case 'phase_change': {
          const p = ev.data
          // Snapshot redelivery after an SSE reconnect re-sends the
          // latest phase_change. Don't wipe the live charts when the
          // state already reflects this exact transition.
          if (
            state.phase === (p.to as LiveState['phase'])
          ) {
            return state
          }
          return {
            ...state,
            phase: p.to as LiveState['phase'],
            // Re-calibrate the live charts at every phase boundary so a
            // slow warmup doesn't leave the work-phase y-axis squashed
            // (and vice versa for cooldown).
            sparklines: { power: [], split: [], dps: [], spm: [] },
            smoothed: null,
          }
        }

        case 'session_paused':
          if (state.session && ev.data.session_id !== state.session.session_id) return state
          return state.serverPaused ? state : { ...state, serverPaused: true }

        case 'session_resumed':
          if (state.session && ev.data.session_id !== state.session.session_id) return state
          return state.serverPaused ? { ...state, serverPaused: false } : state
      }
    }
  }
}
