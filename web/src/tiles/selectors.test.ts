import { describe, it, expect } from 'vitest'
import { selectNumeric, selectSparkline } from './selectors'
import { initialLiveState, liveReducer, type LiveState } from '../live/reducer'
import type { LiveEvent, StrokePayload } from '../live/events'

function pushStroke(state: LiveState, overrides: Partial<StrokePayload> = {}): LiveState {
  const event: LiveEvent = {
    kind: 'stroke',
    id: 1,
    data: {
      session_id: 'S1',
      stroke: 1,
      time_sec: 65.4,
      distance_m: 342,
      spm: 27,
      power_w: 245,
      cal_per_hr: 1175,
      level: 3,
      dps: 8.4,
      stroke_cycle_sec: 2.22,
      pace_sec_per_500m: 132,
      energy_joules: 544,
      ...overrides,
    },
  }
  return liveReducer(state, { type: 'event', event })
}

describe('selectNumeric', () => {
  it('formats zeit / distanz / split / dps / spm / watt', () => {
    const s = pushStroke(initialLiveState)
    expect(selectNumeric(s, 'zeit').value).toBe('1:05.4')
    expect(selectNumeric(s, 'distanz').value).toBe('342')
    expect(selectNumeric(s, 'split').value).toBe('2:12.0')
    expect(selectNumeric(s, 'dps').value).toBe('8.4')
    expect(selectNumeric(s, 'spm').value).toBe('27')
    expect(selectNumeric(s, 'watt').value).toBe('245')
  })

  it('computes SPI = power / SPM and guards the edge cases', () => {
    const ok = pushStroke(initialLiveState, { power_w: 240, spm: 24 })
    expect(selectNumeric(ok, 'spi').value).toBe('10.0')

    const spmZero = pushStroke(initialLiveState, { spm: 0 })
    expect(selectNumeric(spmZero, 'spi').value).toBe('—')

    const lowPower = pushStroke(initialLiveState, { power_w: 15 })
    expect(selectNumeric(lowPower, 'spi').value).toBe('—')
  })

  it('renders em-dash before any stroke arrives', () => {
    expect(selectNumeric(initialLiveState, 'split').value).toBe('—')
    expect(selectNumeric(initialLiveState, 'dps').value).toBe('—')
  })
})

describe('selectSparkline', () => {
  it('returns the power series for watt-verlauf', () => {
    let s = initialLiveState
    s = pushStroke(s, { time_sec: 1, power_w: 200 })
    s = pushStroke(s, { time_sec: 2, power_w: 210 })
    const series = selectSparkline(s, 'watt-verlauf')
    expect(series.points.map((p) => p.value)).toEqual([200, 210])
  })
})
