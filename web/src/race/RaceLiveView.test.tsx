import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as any).ResizeObserver = ResizeObserverStub

import { RaceLiveView } from './RaceLiveView'
import * as dataHook from './useRaceData'
import * as motionHook from './reducedMotion'

const fakeOpps = {
  ghost: { kind: 'session' as const, sourceSessionId: 'g', label: 'ghost' as const, tSec: [0,60], distM: [0, 250] },
  pb: null,
}

describe('RaceLiveView', () => {
  it('renders StatBar + RaceCanvas with workout meters', () => {
    vi.spyOn(dataHook, 'useRaceData').mockReturnValue(fakeOpps as any)
    vi.spyOn(motionHook, 'useReducedMotion').mockReturnValue(false)
    const { container } = render(<RaceLiveView
      liveState={{
        session: { workout_id: 'W1', rower_id: 'R1' },
        stroke: { distance_m: 100, time_sec: 30, power_w: 250, spm: 24, pace_sec_per_500m: 110 },
      } as any}
      totalMeters={2000}
    />)
    expect(container.querySelector('[data-component="stat-bar"]')).toBeTruthy()
    expect(container.querySelector('[data-component="race-canvas"]')).toBeTruthy()
  })
})
