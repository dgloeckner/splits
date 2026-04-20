import { describe, it, expect, vi } from 'vitest'
import { MockChannel } from './channel'
import type { LiveEvent, StrokePayload } from './events'

function makeStroke(id: number, overrides: Partial<StrokePayload> = {}): LiveEvent {
  return {
    kind: 'stroke',
    id,
    data: {
      session_id: '01HV...',
      stroke: id,
      time_sec: id * 2,
      distance_m: id * 8,
      spm: 27,
      power_w: 200,
      cal_per_hr: 800,
      level: 3,
      dps: 8.1,
      stroke_cycle_sec: 2.2,
      pace_sec_per_500m: 132,
      energy_joules: 500,
      ...overrides,
    },
  }
}

describe('MockChannel', () => {
  it('delivers pushed events to the onEvent listener', () => {
    const ch = new MockChannel()
    const onEvent = vi.fn()
    ch.subscribe({ onEvent, onStatus: vi.fn() })
    ch.push(makeStroke(1))
    ch.push(makeStroke(2))
    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(onEvent).toHaveBeenNthCalledWith(1, makeStroke(1))
  })

  it('buffers events pushed before subscribe and delivers them on subscribe', () => {
    const ch = new MockChannel()
    ch.push(makeStroke(1))
    ch.push(makeStroke(2))
    const onEvent = vi.fn()
    ch.subscribe({ onEvent, onStatus: vi.fn() })
    expect(onEvent).toHaveBeenCalledTimes(2)
  })

  it('reports status changes (idle → connecting → open → closed)', () => {
    const ch = new MockChannel()
    const onStatus = vi.fn()
    ch.subscribe({ onEvent: vi.fn(), onStatus })
    ch.setStatus('connecting')
    ch.setStatus('open')
    ch.close()
    expect(onStatus.mock.calls.map((c) => c[0])).toEqual([
      'idle',
      'connecting',
      'open',
      'closed',
    ])
  })

  it('close stops further event delivery', () => {
    const ch = new MockChannel()
    const onEvent = vi.fn()
    ch.subscribe({ onEvent, onStatus: vi.fn() })
    ch.push(makeStroke(1))
    ch.close()
    ch.push(makeStroke(2))
    expect(onEvent).toHaveBeenCalledTimes(1)
  })
})
