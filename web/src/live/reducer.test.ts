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

    it('applies EMA once cold-start window has elapsed', () => {
      vi.setSystemTime(new Date('2026-04-20T10:00:00Z'))
      let s = liveReducer(initialLiveState, { type: 'event', event: start() })
      s = liveReducer(s, {
        type: 'event',
        event: stroke(1, { power_w: 200, spm: 30, dps: 8, pace_sec_per_500m: 130 }),
      })
      // Advance past cold-start window.
      vi.advanceTimersByTime((smoothingConfig.coldStartSeconds + 1) * 1000)
      s = liveReducer(s, {
        type: 'event',
        event: stroke(2, { power_w: 300, spm: 30, dps: 8, pace_sec_per_500m: 130 }),
      })
      // With alpha 0.3: 0.3*300 + 0.7*200 = 230
      expect(s.smoothed!.power).toBeCloseTo(230)
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

  it('ping does not mutate state (identity-stable)', () => {
    const before = liveReducer(initialLiveState, { type: 'event', event: start() })
    const after = liveReducer(before, {
      type: 'event',
      event: { kind: 'ping', id: null, data: {} },
    })
    expect(after).toBe(before)
  })

  it('phase_change updates phase and phaseAnchor', () => {
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
    expect(state.phaseAnchor).toEqual({ distanceM: 10, timeSec: 30.5 })
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
})
