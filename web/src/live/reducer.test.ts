import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { liveReducer, initialLiveState, type LiveState } from './reducer'
import { smoothingConfig } from './smoothing'
import type { LiveEvent, StrokePayload, SessionStartPayload } from './events'

function stroke(id: number, payload: Partial<StrokePayload>): LiveEvent {
  return {
    kind: 'stroke',
    id,
    data: {
      session_id: 'S1',
      stroke: id,
      time_sec: id * 2,
      distance_m: id * 8,
      spm: 27,
      power_w: 200,
      cal_per_hr: 800,
      level: 3,
      dps: 8,
      stroke_cycle_sec: 2.2,
      pace_sec_per_500m: 132,
      energy_joules: 500,
      ...payload,
    },
  }
}

function start(ss: Partial<SessionStartPayload> = {}): LiveEvent {
  return {
    kind: 'session_start',
    id: 0,
    data: {
      session_id: 'S1',
      started_at: '2026-04-20T10:00:00Z',
      rower_id: 'R1',
      rower_name: 'Daniel',
      initial_level: 3,
      ...ss,
    },
  }
}

describe('liveReducer', () => {
  it('initial state has no session, waiting status', () => {
    expect(initialLiveState.status).toBe('idle')
    expect(initialLiveState.session).toBe(null)
    expect(initialLiveState.stroke).toBe(null)
  })

  it('status event updates connectionStatus', () => {
    const s = liveReducer(initialLiveState, {
      type: 'status',
      status: 'open',
    })
    expect(s.status).toBe('open')
  })

  it('session_start sets session and clears any prior stroke', () => {
    let s: LiveState = initialLiveState
    s = liveReducer(s, { type: 'event', event: stroke(1, {}) })
    s = liveReducer(s, { type: 'event', event: start() })
    expect(s.session).not.toBe(null)
    expect(s.session!.rower_name).toBe('Daniel')
    expect(s.stroke).toBe(null)
    expect(s.sparklines.power.length).toBe(0)
    expect(s.sparklines.split.length).toBe(0)
  })

  it('stroke updates latest stroke and appends to sparkline windows', () => {
    let s = liveReducer(initialLiveState, { type: 'event', event: start() })
    s = liveReducer(s, { type: 'event', event: stroke(1, { power_w: 210, pace_sec_per_500m: 130 }) })
    s = liveReducer(s, { type: 'event', event: stroke(2, { power_w: 215, pace_sec_per_500m: 128 }) })
    expect(s.stroke!.stroke).toBe(2)
    expect(s.sparklines.power.map((p) => p.value)).toEqual([210, 215])
    expect(s.sparklines.split.map((p) => p.value)).toEqual([130, 128])
  })

  it('sparkline windows drop points older than the configured window', () => {
    // Phone default is 90 s. Point at t=0 stays while stroke at t=80 arrives;
    // a stroke at t=100 would drop the t=0 point.
    let s = liveReducer(initialLiveState, { type: 'event', event: start() })
    s = liveReducer(s, { type: 'event', event: stroke(1, { time_sec: 0, power_w: 100 }) })
    s = liveReducer(s, { type: 'event', event: stroke(2, { time_sec: 80, power_w: 200 }) })
    s = liveReducer(s, { type: 'event', event: stroke(3, { time_sec: 100, power_w: 300 }) })
    expect(s.sparklines.power.map((p) => p.value)).toEqual([200, 300])
  })

  it('session_finalized replaces summary when session_id matches (PRD-0017 / 0017-03)', () => {
    let s = liveReducer(initialLiveState, { type: 'event', event: start() })
    s = liveReducer(s, {
      type: 'event',
      event: {
        kind: 'session_end',
        id: 2,
        data: {
          session_id: 'S1',
          ended_at: '2026-04-20T10:05:00Z',
          summary: {
            total_distance_m: 2000,
            total_time_sec: 480,
            total_strokes: 200,
            avg_power_w: 250,
            peak_power_w: 320,
            avg_spm: 30,
            avg_dps: 8,
            avg_pace_sec_per_500m: 120,
            session_calories: 200,
          },
        },
      },
    })
    expect(s.summary?.race).toBeUndefined()
    s = liveReducer(s, {
      type: 'event',
      event: {
        kind: 'session_finalized',
        id: 3,
        data: {
          session_id: 'S1',
          summary: {
            total_distance_m: 2000,
            total_time_sec: 480,
            total_strokes: 200,
            avg_power_w: 250,
            peak_power_w: 320,
            avg_spm: 30,
            avg_dps: 8,
            avg_pace_sec_per_500m: 120,
            session_calories: 200,
            race: {
              vs_pb_sec: null,
              vs_ghost_sec: 1.4,
              ghost_kind: 'synth',
            },
          },
        },
      },
    })
    expect(s.summary?.race?.vs_ghost_sec).toBe(1.4)
    expect(s.summary?.race?.ghost_kind).toBe('synth')
  })

  it('session_finalized for a non-matching session_id is ignored', () => {
    let s = liveReducer(initialLiveState, { type: 'event', event: start() })
    const baselineSummary = {
      total_distance_m: 2000,
      total_time_sec: 480,
      total_strokes: 200,
      avg_power_w: 250,
      peak_power_w: 320,
      avg_spm: 30,
      avg_dps: 8,
      avg_pace_sec_per_500m: 120,
      session_calories: 200,
    }
    s = liveReducer(s, {
      type: 'event',
      event: {
        kind: 'session_end',
        id: 2,
        data: { session_id: 'S1', ended_at: '2026-04-20T10:05:00Z', summary: baselineSummary },
      },
    })
    const before = s.summary
    s = liveReducer(s, {
      type: 'event',
      event: {
        kind: 'session_finalized',
        id: 3,
        data: {
          // Belongs to a different (stale) session — must NOT overwrite.
          session_id: 'S_OTHER',
          summary: {
            ...baselineSummary,
            race: { vs_pb_sec: null, vs_ghost_sec: 99, ghost_kind: 'synth' },
          },
        },
      },
    })
    expect(s.summary).toBe(before)
    expect(s.summary?.race).toBeUndefined()
  })

  it('session_end clears live stroke but keeps session summary', () => {
    let s = liveReducer(initialLiveState, { type: 'event', event: start() })
    s = liveReducer(s, { type: 'event', event: stroke(1, {}) })
    s = liveReducer(s, {
      type: 'event',
      event: {
        kind: 'session_end',
        id: 2,
        data: {
          session_id: 'S1',
          ended_at: '2026-04-20T10:05:00Z',
          summary: {
            total_distance_m: 1035,
            total_time_sec: 284,
            total_strokes: 124,
            avg_power_w: 259,
            peak_power_w: 322,
            avg_spm: 26.3,
            avg_dps: 8.35,
            avg_pace_sec_per_500m: 137,
            session_calories: 112,
          },
        },
      },
    })
    expect(s.stroke).toBe(null)
    expect(s.session).not.toBe(null)
    expect(s.summary?.total_strokes).toBe(124)
  })

  it('ignores a redelivered session_end for a different session', () => {
    // state tracking session S2, stale session_end for S1 arrives
    let s = liveReducer(initialLiveState, { type: 'event', event: start({ session_id: 'S2' }) })
    const baselineSummary = {
      total_distance_m: 2000,
      total_time_sec: 480,
      total_strokes: 200,
      avg_power_w: 250,
      peak_power_w: 320,
      avg_spm: 30,
      avg_dps: 8,
      avg_pace_sec_per_500m: 120,
      session_calories: 200,
    }
    s = liveReducer(s, {
      type: 'event',
      event: {
        kind: 'session_end',
        id: 2,
        data: {
          session_id: 'S2',
          ended_at: '2026-04-20T10:05:00Z',
          summary: baselineSummary,
        },
      },
    })
    const before = s.summary
    // Stale session_end for S1 arrives — must NOT overwrite
    s = liveReducer(s, {
      type: 'event',
      event: {
        kind: 'session_end',
        id: 3,
        data: {
          session_id: 'S1',
          ended_at: '2026-04-20T10:04:00Z',
          summary: {
            total_distance_m: 1000,
            total_time_sec: 240,
            total_strokes: 100,
            avg_power_w: 200,
            peak_power_w: 250,
            avg_spm: 28,
            avg_dps: 8,
            avg_pace_sec_per_500m: 140,
            session_calories: 100,
          },
        },
      },
    })
    expect(s.summary).toBe(before)
    expect(s.summary?.total_strokes).toBe(200)
  })

  describe('smoothed values + cold-start', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('seeds smoothed=null and sessionStartedAtMs=null on session_start', () => {
      let s: LiveState = initialLiveState
      s = liveReducer(s, { type: 'event', event: stroke(1, {}) })
      s = liveReducer(s, { type: 'event', event: start() })
      expect(s.smoothed).toBe(null)
      expect(s.sessionStartedAtMs).toBe(null)
    })

    it('first stroke captures sessionStartedAtMs and uses raw values in cold-start', () => {
      vi.setSystemTime(new Date('2026-04-20T10:00:00Z'))
      let s = liveReducer(initialLiveState, { type: 'event', event: start() })
      s = liveReducer(s, {
        type: 'event',
        event: stroke(1, { power_w: 250, spm: 30, dps: 8, pace_sec_per_500m: 130 }),
      })
      expect(s.sessionStartedAtMs).toBe(Date.now())
      expect(s.smoothed).toEqual({
        power: 250,
        paceSecPer500m: 130,
        spm: 30,
        dps: 8,
        spi: 250 / 30,
      })
    })

    it('passes raw device values straight through once cold-start has elapsed', () => {
      // Watts / SPM / DPS / split-pace are pass-through after the
      // methodology change — they match the rower console exactly,
      // no EMA lag. Only SPI keeps its EMA (it's derived).
      vi.setSystemTime(new Date('2026-04-20T10:00:00Z'))
      let s = liveReducer(initialLiveState, { type: 'event', event: start() })
      s = liveReducer(s, {
        type: 'event',
        event: stroke(1, { power_w: 200, spm: 30, dps: 8, pace_sec_per_500m: 130 }),
      })
      vi.advanceTimersByTime((smoothingConfig.coldStartSeconds + 1) * 1000)
      s = liveReducer(s, {
        type: 'event',
        event: stroke(2, { power_w: 300, spm: 32, dps: 9, pace_sec_per_500m: 125 }),
      })
      expect(s.smoothed!.power).toBe(300)
      expect(s.smoothed!.spm).toBe(32)
      expect(s.smoothed!.dps).toBe(9)
      expect(s.smoothed!.paceSecPer500m).toBe(125)
      // SPI is still EMA'd: alpha 0.3 → 0.3 * (300/32) + 0.7 * (200/30)
      const expectedSpi = 0.3 * (300 / 32) + 0.7 * (200 / 30)
      expect(s.smoothed!.spi).toBeCloseTo(expectedSpi)
    })

    it('retains previous smoothed SPI when stroke is below threshold', () => {
      vi.setSystemTime(new Date('2026-04-20T10:00:00Z'))
      let s = liveReducer(initialLiveState, { type: 'event', event: start() })
      s = liveReducer(s, {
        type: 'event',
        event: stroke(1, { power_w: 240, spm: 30 }),
      })
      const seededSpi = s.smoothed!.spi
      vi.advanceTimersByTime((smoothingConfig.coldStartSeconds + 1) * 1000)
      s = liveReducer(s, {
        type: 'event',
        event: stroke(2, { power_w: 10, spm: 30 }),
      })
      expect(s.smoothed!.spi).toBe(seededSpi)
    })
  })

  it('session_start carries workout_id when present', () => {
    const s = liveReducer(initialLiveState, {
      type: 'event',
      event: start({ workout_id: 'W1' }),
    })
    expect(s.session?.workout_id).toBe('W1')
  })

  it('stroke with new session_id clears stale workout_id from prior session', () => {
    let s: LiveState = initialLiveState
    s = liveReducer(s, { type: 'event', event: start({ workout_id: 'W1' }) })
    expect(s.session?.workout_id).toBe('W1')
    s = liveReducer(s, { type: 'event', event: stroke(1, { session_id: 'S2' }) })
    expect(s.session?.session_id).toBe('S2')
    expect(s.session?.workout_id).toBeUndefined()
  })

  it('ping does not mutate state (identity-stable)', () => {
    const before = liveReducer(initialLiveState, { type: 'event', event: start() })
    const after = liveReducer(before, {
      type: 'event',
      event: { kind: 'ping', id: null, data: {} },
    })
    expect(after).toBe(before)
  })

  it('phase_change updates phase', () => {
    const state = liveReducer(initialLiveState, {
      type: 'event',
      event: {
        kind: 'phase_change',
        id: 1,
        data: {
          session_id: 's1',
          from: 'warmup',
          to: 'work',
          at_stroke: 5,
          at_time_sec: 30.5,
          at_distance_m: 10,
        },
      },
    })
    expect(state.phase).toBe('work')
  })

  it('workout_attached resets sparklines and smoothed (drops free-row prelude)', () => {
    let s: LiveState = liveReducer(initialLiveState, { type: 'event', event: start() })
    s = liveReducer(s, { type: 'event', event: stroke(1, {}) })
    s = liveReducer(s, { type: 'event', event: stroke(2, {}) })
    expect(s.sparklines.power.length).toBeGreaterThan(0)
    expect(s.smoothed).not.toBeNull()
    s = liveReducer(s, {
      type: 'event',
      event: { kind: 'workout_attached', id: 99, data: { session_id: 'S1', workout_id: 'W7' } },
    })
    expect(s.session?.workout_id).toBe('W7')
    expect(s.sparklines).toEqual({ power: [], split: [], dps: [], spm: [] })
    expect(s.smoothed).toBeNull()
  })

  it('redelivered phase_change (snapshot replay) does not wipe sparklines', () => {
    function stateWithSparklines(): LiveState {
      let s = liveReducer(initialLiveState, { type: 'event', event: start() })
      s = liveReducer(s, { type: 'event', event: stroke(1, { power_w: 200 }) })
      s = liveReducer(s, { type: 'event', event: stroke(2, { power_w: 210 }) })
      return s
    }
    const pc = {
      kind: 'phase_change' as const,
      id: 10,
      data: {
        session_id: 's1', from: 'warmup', to: 'work',
        at_stroke: 5, at_time_sec: 120, at_distance_m: 400,
      },
    }
    const s = liveReducer(stateWithSparklines(), { type: 'event', event: pc })
    const after = liveReducer(s, { type: 'event', event: pc })
    expect(after).toBe(s) // object identity — no wipe, no new state
  })

  it('stroke updates phase from payload', () => {
    const state = liveReducer(initialLiveState, {
      type: 'event',
      event: {
        kind: 'stroke',
        id: 2,
        data: {
          session_id: 's1',
          stroke: 1,
          time_sec: 1,
          distance_m: 5,
          spm: 20,
          power_w: 100,
          cal_per_hr: 0,
          level: 0,
          dps: 5,
          stroke_cycle_sec: 1,
          pace_sec_per_500m: 150,
          energy_joules: 100,
          phase: 'warmup',
        },
      },
    })
    expect(state.phase).toBe('warmup')
  })

  it('applies session_end with no active session (cold reconnect)', () => {
    // Cold reconnect: client has no tracked session, catches up on a just-ended session
    const freshState = initialLiveState
    const end = {
      kind: 'session_end' as const,
      id: 99,
      data: {
        session_id: 's1',
        ended_at: '2026-06-10T10:00:00Z',
        summary: {
          total_distance_m: 2000,
          total_time_sec: 480,
          total_strokes: 200,
          avg_power_w: 250,
          peak_power_w: 320,
          avg_spm: 30,
          avg_dps: 8,
          avg_pace_sec_per_500m: 120,
          session_calories: 200,
        },
      },
    }
    const after = liveReducer(freshState, { type: 'event', event: end })
    // Should apply: state.session is null so the guard doesn't fire
    expect(after.summary).toEqual(end.data.summary)
    expect(after.stroke).toBe(null)
  })

  it('implicit new session from stroke clears phase', () => {
    // Previous session ended with a work phase.
    let s = liveReducer(initialLiveState, { type: 'event', event: start({ session_id: 's1' }) })
    s = liveReducer(s, { type: 'event', event: stroke(1, { session_id: 's1' }) })
    s = {
      ...s,
      phase: 'work',
    }
    const strokeNewSession = stroke(200, { session_id: 's2', distance_m: 5 })
    const after = liveReducer(s, { type: 'event', event: strokeNewSession })
    expect(after.phase).toBeNull()
  })

  it('is a pure function of (state, action) when nowMs is supplied', () => {
    const strokeEvent = { kind: 'stroke' as const, id: 3, data: { ...(stroke(1, {}).data as StrokePayload), session_id: 's1' } }
    const a = liveReducer(initialLiveState, { type: 'event', event: strokeEvent, nowMs: 1_000_000 })
    const b = liveReducer(initialLiveState, { type: 'event', event: strokeEvent, nowMs: 1_000_000 })
    expect(a).toEqual(b)
    expect(a.lastStrokeReceivedAtMs).toBe(1_000_000)
    expect(a.sessionStartedAtMs).toBe(1_000_000)
  })

  describe('session_paused / session_resumed', () => {
    function stateWithSession(): LiveState {
      return liveReducer(initialLiveState, { type: 'event', event: start() })
    }

    it('session_paused sets serverPaused to true', () => {
      const s = liveReducer(stateWithSession(), {
        type: 'event',
        event: { kind: 'session_paused', id: 10, data: { session_id: 'S1', at_time_sec: 42.5 } },
      })
      expect(s.serverPaused).toBe(true)
    })

    it('session_resumed after pause clears serverPaused', () => {
      let s = liveReducer(stateWithSession(), {
        type: 'event',
        event: { kind: 'session_paused', id: 10, data: { session_id: 'S1', at_time_sec: 42.5 } },
      })
      s = liveReducer(s, {
        type: 'event',
        event: { kind: 'session_resumed', id: 11, data: { session_id: 'S1', at_time_sec: 42.5 } },
      })
      expect(s.serverPaused).toBe(false)
    })

    it('session_paused with mismatched session_id leaves state unchanged', () => {
      const before = stateWithSession()
      const after = liveReducer(before, {
        type: 'event',
        event: { kind: 'session_paused', id: 10, data: { session_id: 'S_OTHER', at_time_sec: 10 } },
      })
      expect(after).toBe(before)
    })

    it('session_resumed with mismatched session_id leaves state unchanged', () => {
      let s = liveReducer(stateWithSession(), {
        type: 'event',
        event: { kind: 'session_paused', id: 10, data: { session_id: 'S1', at_time_sec: 42.5 } },
      })
      const before = s
      s = liveReducer(s, {
        type: 'event',
        event: { kind: 'session_resumed', id: 11, data: { session_id: 'S_OTHER', at_time_sec: 42.5 } },
      })
      expect(s).toBe(before)
    })

    it('serverPaused is false in initialLiveState (hydration-compat: undefined is falsy)', () => {
      // A LiveState serialised before serverPaused was added will have
      // the key missing (undefined). Boolean(undefined) === false, so
      // the reducer's `state.serverPaused ?` guard treats it as false
      // and session_paused will still set it to true.
      expect(initialLiveState.serverPaused).toBe(false)
      const staleState = { ...initialLiveState } as LiveState & { serverPaused?: boolean }
      delete staleState.serverPaused
      expect(staleState.serverPaused).toBeUndefined()
      // Falsy guard means session_paused still activates correctly
      const after = liveReducer(staleState as LiveState, {
        type: 'event',
        event: { kind: 'session_paused', id: 1, data: { session_id: 'S1', at_time_sec: 5 } },
      })
      expect(after.serverPaused).toBe(true)
    })
  })
})
