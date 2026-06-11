import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SparklineTile } from './SparklineTile'
import { getTile } from './registry'
import { initialLiveState, liveReducer, type LiveState } from '../live/reducer'
import type { LiveEvent, StrokePayload } from '../live/events'

function pushStroke(state: LiveState, overrides: Partial<StrokePayload> = {}): LiveState {
  const event: LiveEvent = {
    kind: 'stroke',
    id: 1,
    data: {
      session_id: 'S1',
      stroke: 1,
      time_sec: 1,
      distance_m: 10,
      spm: 27,
      power_w: 245,
      cal_per_hr: 1175,
      level: 3,
      dps: 8.4,
      stroke_cycle_sec: 2.22,
      pace_sec_per_500m: 132,
      energy_joules: 544,
      work_distance_m: 0,
      work_time_sec: 0,
      phase_distance_m: 0,
      phase_time_sec: 0,
      ...overrides,
    },
  }
  return liveReducer(state, { type: 'event', event })
}

describe('SparklineTile', () => {
  const wattDef = getTile('watt-verlauf')!

  it('renders just the label + placeholder when no data yet', () => {
    const { container } = render(<SparklineTile def={wattDef} state={initialLiveState} />)
    expect(container.textContent).toContain('Watt')
    expect(container.textContent).toContain('sammle Daten')
    // No edge labels before data arrives.
    expect(container.querySelector('[class*="edges"]')).toBeNull()
  })

  it('renders min/max edge labels without unit once points arrive', () => {
    let s = initialLiveState
    s = pushStroke(s, { time_sec: 1, power_w: 200 })
    s = pushStroke(s, { time_sec: 2, power_w: 260 })
    s = pushStroke(s, { time_sec: 3, power_w: 230 })
    const { container } = render(<SparklineTile def={wattDef} state={s} />)
    // Current value was intentionally removed — dedicated numeric tiles
    // already show the latest reading.
    expect(container.querySelector('[class*="current"]')).toBeNull()
    const min = container.querySelector('[class*="edgeMin"]')
    const max = container.querySelector('[class*="edgeMax"]')
    expect(min?.textContent).toBe('200')
    expect(max?.textContent).toBe('260')
  })

  it('formats split corner labels as m:ss with no tenths', () => {
    const splitDef = getTile('split-verlauf')!
    let s = initialLiveState
    s = pushStroke(s, { time_sec: 1, pace_sec_per_500m: 120 })
    s = pushStroke(s, { time_sec: 2, pace_sec_per_500m: 135 })
    const { container } = render(<SparklineTile def={splitDef} state={s} />)
    const min = container.querySelector('[class*="edgeMin"]')
    const max = container.querySelector('[class*="edgeMax"]')
    expect(min?.textContent).toBe('2:00')
    expect(max?.textContent).toBe('2:15')
  })
})
