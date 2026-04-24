import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LiveHero } from './LiveHero'
import { initialLiveState, liveReducer, type LiveState } from '../live/reducer'

function state(): LiveState {
  return liveReducer(initialLiveState, {
    type: 'event',
    event: {
      kind: 'stroke',
      id: 1,
      data: {
        session_id: 'S',
        stroke: 1,
        time_sec: 125.3,
        distance_m: 512,
        spm: 27,
        power_w: 245,
        cal_per_hr: 800,
        level: 3,
        dps: 8.4,
        stroke_cycle_sec: 2.22,
        pace_sec_per_500m: 132,
        energy_joules: 544,
      },
    },
  })
}

describe('LiveHero', () => {
  it('renders split as the dominant value', () => {
    render(<LiveHero state={state()} />)
    expect(screen.getByText('2:12,0')).toBeInTheDocument()
  })

  it('renders Zeit, Distanz, SPM, Watt in the secondary row', () => {
    render(<LiveHero state={state()} />)
    expect(screen.getByText('2:05')).toBeInTheDocument()
    expect(screen.getByText('512')).toBeInTheDocument()
    expect(screen.getByText('27')).toBeInTheDocument()
    expect(screen.getByText('245')).toBeInTheDocument()
  })

  it('shows waiting state when no stroke has arrived', () => {
    render(<LiveHero state={initialLiveState} />)
    expect(screen.getByText('Split')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
