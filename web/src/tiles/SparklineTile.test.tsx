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
      ...overrides,
    },
  }
  return liveReducer(state, { type: 'event', event })
}

describe('SparklineTile', () => {
  const wattDef = getTile('watt-verlauf')!

  it('renders just the label + placeholder when no data yet', () => {
    const { container } = render(<SparklineTile def={wattDef} state={initialLiveState} />)
    expect(container.textContent).toContain('Watt-Verlauf')
    expect(container.textContent).toContain('sammle Daten')
    // No corner labels before data arrives.
    expect(container.querySelector('[class*="minLabel"]')).toBeNull()
    expect(container.querySelector('[class*="maxLabel"]')).toBeNull()
  })

  it('renders current value + min/max corner labels once points arrive', () => {
    let s = initialLiveState
    s = pushStroke(s, { time_sec: 1, power_w: 200 })
    s = pushStroke(s, { time_sec: 2, power_w: 260 })
    s = pushStroke(s, { time_sec: 3, power_w: 230 })
    const { container } = render(<SparklineTile def={wattDef} state={s} />)
    // Current value = last point = 230, with "W" unit.
    const current = container.querySelector('[class*="current"]')
    expect(current?.textContent).toContain('230')
    expect(current?.textContent).toContain('W')
    const min = container.querySelector('[class*="minLabel"]')
    const max = container.querySelector('[class*="maxLabel"]')
    expect(min?.textContent).toBe('200')
    expect(max?.textContent).toBe('260')
  })

  it('formats split corner labels as mm:ss', () => {
    const splitDef = getTile('split-verlauf')!
    let s = initialLiveState
    s = pushStroke(s, { time_sec: 1, pace_sec_per_500m: 120 })
    s = pushStroke(s, { time_sec: 2, pace_sec_per_500m: 135 })
    const { container } = render(<SparklineTile def={splitDef} state={s} />)
    const min = container.querySelector('[class*="minLabel"]')
    const max = container.querySelector('[class*="maxLabel"]')
    // mmss with 120 → "2:00.0", 135 → "2:15.0"
    expect(min?.textContent).toBe('2:00.0')
    expect(max?.textContent).toBe('2:15.0')
  })
})
