import { describe, it, expect } from 'vitest'
import { initialRaceLifecycle, raceLifecycle, type RaceLifecycleState } from './raceLifecycle'

function run(events: Parameters<typeof raceLifecycle>[1][]): RaceLifecycleState {
  let s = initialRaceLifecycle()
  for (const e of events) s = raceLifecycle(s, e)
  return s
}

describe('raceLifecycle reducer', () => {
  it('starts in Confirmed', () => {
    const s = initialRaceLifecycle()
    expect(s.phase).toBe('Confirmed')
    expect(s.race_t0).toBeNull()
    expect(s.falschstart).toBe(false)
    expect(s.latchedResult).toBeNull()
  })

  it('Confirmed --confirm--> Bereit', () => {
    const s = run([{ type: 'confirm' }])
    expect(s.phase).toBe('Bereit')
  })

  it('Bereit --bereitTap--> Ceremony(ATTENTION) at given tap time', () => {
    const s = run([{ type: 'confirm' }, { type: 'bereitTap', t: 1000 }])
    expect(s.phase).toBe('Ceremony')
    expect(s.ceremonyStep).toBe('ATTENTION')
    expect(s.bereitTapAtMs).toBe(1000)
  })

  it('Each 1500ms tick advances ATTENTION → SET → GO → Live(NormalStart)', () => {
    let s = run([{ type: 'confirm' }, { type: 'bereitTap', t: 1000 }])
    s = raceLifecycle(s, { type: 'tick', nowMs: 2500 })
    expect(s.phase).toBe('Ceremony')
    expect(s.ceremonyStep).toBe('SET')
    s = raceLifecycle(s, { type: 'tick', nowMs: 4000 })
    expect(s.phase).toBe('Ceremony')
    expect(s.ceremonyStep).toBe('GO')
    expect(s.race_t0).toBe(4000)
    s = raceLifecycle(s, { type: 'tick', nowMs: 5500 })
    expect(s.phase).toBe('Live')
    expect(s.liveKind).toBe('NormalStart')
    expect(s.race_t0).toBe(4000)
    expect(s.falschstart).toBe(false)
  })

  it('Stroke during ATTENTION → Live(Falschstart), race_t0 stays pending GO', () => {
    let s = run([{ type: 'confirm' }, { type: 'bereitTap', t: 0 }])
    // in ATTENTION
    s = raceLifecycle(s, { type: 'stroke', t: 500, dist: 1, userDistance: 1 })
    expect(s.phase).toBe('Live')
    expect(s.liveKind).toBe('Falschstart')
    expect(s.falschstart).toBe(true)
    expect(s.session_start).toBe(500)
    // race_t0 = pending GO moment (bereitTap + 3000ms)
    expect(s.race_t0).toBe(3000)
  })

  it('Stroke during SET → Live(Falschstart)', () => {
    let s = run([{ type: 'confirm' }, { type: 'bereitTap', t: 0 }])
    s = raceLifecycle(s, { type: 'tick', nowMs: 1500 })
    expect(s.ceremonyStep).toBe('SET')
    s = raceLifecycle(s, { type: 'stroke', t: 2000, dist: 2, userDistance: 2 })
    expect(s.phase).toBe('Live')
    expect(s.liveKind).toBe('Falschstart')
    expect(s.race_t0).toBe(3000)
    expect(s.session_start).toBe(2000)
  })

  it('userDistance >= total → Finished', () => {
    let s = run([
      { type: 'confirm' },
      { type: 'bereitTap', t: 0 },
      { type: 'tick', nowMs: 1500 },
      { type: 'tick', nowMs: 3000 },
      { type: 'tick', nowMs: 4500 },
    ])
    expect(s.phase).toBe('Live')
    s = raceLifecycle(s, { type: 'stroke', t: 100, dist: 2000, userDistance: 2000, total: 2000 })
    expect(s.phase).toBe('Finished')
    // Without configured totalMeters/opponents the latch still fires
    // with finalTimeS = stroke t and no gaps.
    expect(s.latchedResult).not.toBeNull()
    expect(s.latchedResult?.finalTimeS).toBe(100)
    expect(s.latchedResult?.gaps).toEqual({})
  })

  it('finish-cross stroke latches result; subsequent strokes do NOT recompute', () => {
    const ghost = { tSec: [0, 100, 200], distM: [0, 1000, 2000] }
    let s = initialRaceLifecycle({ totalMeters: 2000, opponents: { ghost } })
    s = raceLifecycle(s, { type: 'confirm' })
    s = raceLifecycle(s, { type: 'bereitTap', t: 0 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 1500 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 3000 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 4500 })
    // Two strokes mid-race so the latch can derive a split from the last 2.
    s = raceLifecycle(s, { type: 'stroke', t: 90, dist: 1958, userDistance: 1958, total: 2000 })
    s = raceLifecycle(s, { type: 'stroke', t: 100, dist: 2000, userDistance: 2000, total: 2000 })
    expect(s.phase).toBe('Finished')
    expect(s.latchedResult).not.toBeNull()
    const latched = s.latchedResult
    expect(latched?.finalTimeS).toBe(100)
    // ghost at 2000 m → 200 s. User finished at 100 s → -100 s.
    expect(latched?.gaps.ghost).toBeCloseTo(-100, 6)
    // Subsequent stroke (Paddelst aus) must NOT change the latched result.
    s = raceLifecycle(s, { type: 'stroke', t: 110, dist: 2010, userDistance: 2010, total: 2000 })
    expect(s.phase).toBe('Finished')
    expect(s.latchedResult).toBe(latched)
  })

  it('sessionEnd from Finished → Post carries the latched result', () => {
    const ghost = { tSec: [0, 100, 200], distM: [0, 1000, 2000] }
    let s = initialRaceLifecycle({ totalMeters: 2000, opponents: { ghost } })
    s = raceLifecycle(s, { type: 'confirm' })
    s = raceLifecycle(s, { type: 'bereitTap', t: 0 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 1500 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 3000 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 4500 })
    s = raceLifecycle(s, { type: 'stroke', t: 90, dist: 1958, userDistance: 1958, total: 2000 })
    s = raceLifecycle(s, { type: 'stroke', t: 100, dist: 2000, userDistance: 2000, total: 2000 })
    const latched = s.latchedResult
    s = raceLifecycle(s, { type: 'sessionEnd' })
    expect(s.phase).toBe('Post')
    expect(s.latchedResult).toBe(latched)
  })

  it('sessionEnd from Live → Post', () => {
    let s = run([
      { type: 'confirm' },
      { type: 'bereitTap', t: 0 },
      { type: 'tick', nowMs: 1500 },
      { type: 'tick', nowMs: 3000 },
      { type: 'tick', nowMs: 4500 },
    ])
    s = raceLifecycle(s, { type: 'sessionEnd' })
    expect(s.phase).toBe('Post')
  })

  it('sessionEnd from Finished → Post', () => {
    let s = run([
      { type: 'confirm' },
      { type: 'bereitTap', t: 0 },
      { type: 'tick', nowMs: 1500 },
      { type: 'tick', nowMs: 3000 },
      { type: 'tick', nowMs: 4500 },
      { type: 'stroke', t: 100, dist: 2000, userDistance: 2000, total: 2000 },
    ])
    expect(s.phase).toBe('Finished')
    s = raceLifecycle(s, { type: 'sessionEnd' })
    expect(s.phase).toBe('Post')
  })

  it('abort from Bereit → Aborted', () => {
    const s = run([{ type: 'confirm' }, { type: 'abort' }])
    expect(s.phase).toBe('Aborted')
  })

  it('abort from Ceremony → Aborted', () => {
    const s = run([{ type: 'confirm' }, { type: 'bereitTap', t: 0 }, { type: 'abort' }])
    expect(s.phase).toBe('Aborted')
  })

  it('abort from Live → Aborted', () => {
    const s = run([
      { type: 'confirm' },
      { type: 'bereitTap', t: 0 },
      { type: 'tick', nowMs: 1500 },
      { type: 'tick', nowMs: 3000 },
      { type: 'tick', nowMs: 4500 },
      { type: 'abort' },
    ])
    expect(s.phase).toBe('Aborted')
  })

  it('abort from Finished is no-op (terminal-ish, kept Finished)', () => {
    let s = run([
      { type: 'confirm' },
      { type: 'bereitTap', t: 0 },
      { type: 'tick', nowMs: 1500 },
      { type: 'tick', nowMs: 3000 },
      { type: 'tick', nowMs: 4500 },
      { type: 'stroke', t: 100, dist: 2000, userDistance: 2000, total: 2000 },
    ])
    expect(s.phase).toBe('Finished')
    s = raceLifecycle(s, { type: 'abort' })
    // Finished is terminal — abort does not transition
    expect(s.phase).toBe('Finished')
  })

  it('events from Aborted are no-ops', () => {
    let s = run([{ type: 'confirm' }, { type: 'abort' }])
    s = raceLifecycle(s, { type: 'tick', nowMs: 9999 })
    expect(s.phase).toBe('Aborted')
  })
})
