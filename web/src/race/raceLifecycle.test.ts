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

  it('Falschstart latch: `falschstartShownAtMs` set from event.nowMs on Ceremony(ATTENTION)→Live', () => {
    let s = run([{ type: 'confirm' }, { type: 'bereitTap', t: 0 }])
    expect(s.falschstartShownAtMs).toBeNull()
    s = raceLifecycle(s, {
      type: 'stroke',
      t: 500,
      dist: 1,
      userDistance: 1,
      nowMs: 84_123.5,
    })
    expect(s.falschstart).toBe(true)
    expect(s.falschstartShownAtMs).toBe(84_123.5)
  })

  it('Falschstart latch: one-shot — subsequent strokes never overwrite it', () => {
    let s = run([{ type: 'confirm' }, { type: 'bereitTap', t: 0 }])
    // First stroke triggers Falschstart, latches the timestamp.
    s = raceLifecycle(s, {
      type: 'stroke',
      t: 500,
      dist: 1,
      userDistance: 1,
      nowMs: 100,
    })
    expect(s.falschstartShownAtMs).toBe(100)
    // Subsequent strokes in Live — even with a different nowMs — must
    // leave the latch alone. The toast lifetime is anchored to the
    // first observation; no flicker if React re-renders.
    s = raceLifecycle(s, {
      type: 'stroke',
      t: 600,
      dist: 5,
      userDistance: 5,
      nowMs: 200,
    })
    expect(s.falschstartShownAtMs).toBe(100)
    s = raceLifecycle(s, {
      type: 'stroke',
      t: 700,
      dist: 12,
      userDistance: 12,
      total: 2000,
      nowMs: 300,
    })
    expect(s.falschstartShownAtMs).toBe(100)
  })

  it('sessionEnd safeguard: late-latches a Finished if _prevStroke shows a completed cross', () => {
    // Simulates the fast-fixture race condition: the dispatched stroke
    // event reached the reducer with `event.total` missing or with the
    // batched render losing the cross-stroke commit, so the reducer
    // never transitioned Live → Finished — but _prevStroke shows the
    // user did cross the line. Without the safeguard, sessionEnd
    // would dump the rower onto Post with `latchedResult === null`.
    let s = initialRaceLifecycle({ totalMeters: 500 })
    s = raceLifecycle(s, { type: 'confirm' })
    s = raceLifecycle(s, { type: 'bereitTap', t: 0 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 4500 })
    expect(s.phase).toBe('Live')
    expect(s.liveKind).toBe('NormalStart')
    // Strokes processed without the cross-trigger firing (e.g. because
    // event.total was missing). _prevStroke nonetheless reflects a
    // post-finish-line distance.
    s = raceLifecycle(s, {
      type: 'stroke',
      t: 100,
      dist: 506,
      userDistance: 506,
      // total intentionally omitted — this is the bug we're guarding
      // against. Without `total` the cross-check is skipped.
    })
    expect(s.phase).toBe('Live')
    expect(s._prevStroke).toEqual({ t: 100, dist: 506 })
    // sessionEnd arrives. Safeguard: detect crossed _prevStroke and
    // transition to Finished + late-latch a result.
    s = raceLifecycle(s, { type: 'sessionEnd' })
    expect(s.phase).toBe('Finished')
    expect(s.latchedResult).not.toBeNull()
    expect(s.latchedResult?.finalTimeS).toBe(100)
  })

  it('sessionEnd from Live with no cross → Post (legacy behaviour preserved)', () => {
    let s = initialRaceLifecycle({ totalMeters: 500 })
    s = raceLifecycle(s, { type: 'confirm' })
    s = raceLifecycle(s, { type: 'bereitTap', t: 0 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 4500 })
    expect(s.phase).toBe('Live')
    // Some pre-finish strokes only.
    s = raceLifecycle(s, { type: 'stroke', t: 10, dist: 100, userDistance: 100, total: 500 })
    s = raceLifecycle(s, { type: 'sessionEnd' })
    expect(s.phase).toBe('Post')
    expect(s.latchedResult).toBeNull()
  })

  it('Falschstart latch: NormalStart (Ceremony(GO!)→Live) never sets it', () => {
    let s = run([
      { type: 'confirm' },
      { type: 'bereitTap', t: 0 },
      { type: 'tick', nowMs: 1500 },
      { type: 'tick', nowMs: 3000 },
    ])
    expect(s.ceremonyStep).toBe('GO')
    s = raceLifecycle(s, {
      type: 'stroke',
      t: 3.5,
      dist: 8,
      userDistance: 8,
      total: 2000,
      nowMs: 99,
    })
    expect(s.liveKind).toBe('NormalStart')
    expect(s.falschstart).toBe(false)
    expect(s.falschstartShownAtMs).toBeNull()
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

  it('Stroke during GO! → Live(NormalStart), records session_start + _prevStroke (0017-04)', () => {
    let s = run([
      { type: 'confirm' },
      { type: 'bereitTap', t: 0 },
      { type: 'tick', nowMs: 1500 },
      { type: 'tick', nowMs: 3000 },
    ])
    expect(s.phase).toBe('Ceremony')
    expect(s.ceremonyStep).toBe('GO')
    expect(s.race_t0).toBe(3000)
    s = raceLifecycle(s, { type: 'stroke', t: 3.5, dist: 8, userDistance: 8, total: 2000 })
    expect(s.phase).toBe('Live')
    expect(s.liveKind).toBe('NormalStart')
    expect(s.ceremonyStep).toBeNull()
    expect(s.falschstart).toBe(false)
    expect(s.session_start).toBe(3.5)
    expect(s._prevStroke).toEqual({ t: 3.5, dist: 8 })
    // race_t0 unchanged from the GO! moment set at bereitTap.
    expect(s.race_t0).toBe(3000)
  })

  it('Stroke during GO! with userDistance >= total → Finished in one step (0017-04)', () => {
    const ghost = { tSec: [0, 100, 200], distM: [0, 1000, 2000] }
    let s = initialRaceLifecycle({ totalMeters: 2000, opponents: { ghost } })
    s = raceLifecycle(s, { type: 'confirm' })
    s = raceLifecycle(s, { type: 'bereitTap', t: 0 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 1500 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 3000 })
    expect(s.ceremonyStep).toBe('GO')
    // Whole fixture compresses into the GO! window: first stroke is already
    // a finish-cross. Reducer must skip the Live frame and latch immediately.
    s = raceLifecycle(s, { type: 'stroke', t: 100, dist: 2000, userDistance: 2000, total: 2000 })
    expect(s.phase).toBe('Finished')
    expect(s.session_start).toBe(100)
    expect(s.latchedResult).not.toBeNull()
    expect(s.latchedResult?.finalTimeS).toBe(100)
    expect(s._prevStroke).toEqual({ t: 100, dist: 2000 })
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

  it('sessionEnd from Finished is ignored — the freeze stays up until the rower taps Fertig (0019-02/03)', () => {
    const ghost = { tSec: [0, 100, 200], distM: [0, 1000, 2000] }
    let s = initialRaceLifecycle({ totalMeters: 2000, opponents: { ghost } })
    s = raceLifecycle(s, { type: 'confirm' })
    s = raceLifecycle(s, { type: 'bereitTap', t: 0 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 1500 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 3000 })
    s = raceLifecycle(s, { type: 'tick', nowMs: 4500 })
    s = raceLifecycle(s, { type: 'stroke', t: 90, dist: 1958, userDistance: 1958, total: 2000 })
    s = raceLifecycle(s, { type: 'stroke', t: 100, dist: 2000, userDistance: 2000, total: 2000 })
    expect(s.phase).toBe('Finished')
    const latched = s.latchedResult
    s = raceLifecycle(s, { type: 'sessionEnd' })
    // Post-finish session_end must NOT collapse the race surface — the
    // StatBar / Canvas / FinishOverlay freeze persists across the
    // paddle-down. Fertig is the only Finished → Post path.
    expect(s.phase).toBe('Finished')
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

  it('sessionEnd from Finished is a no-op (stays Finished — Fertig is the explicit exit)', () => {
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
    expect(s.phase).toBe('Finished')
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
