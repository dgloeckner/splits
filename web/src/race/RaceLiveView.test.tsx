import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { initialLiveState, type LiveState } from '../live/reducer'

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

  it('after finish horn: StatBar values and Canvas user-distance freeze across post-horn rerenders', () => {
    vi.spyOn(dataHook, 'useRaceData').mockReturnValue(fakeOpps as any)
    vi.spyOn(motionHook, 'useReducedMotion').mockReturnValue(false)
    const baseStroke = {
      session_id: 's1', stroke: 1, time_sec: 0, distance_m: 0, spm: 0, power_w: 0,
      cal_per_hr: 0, level: 0, dps: 0, stroke_cycle_sec: 0, pace_sec_per_500m: 0,
      energy_joules: 0, work_distance_m: 0, work_time_sec: 0, phase_distance_m: 0, phase_time_sec: 0,
    }
    const makeState = (s: Partial<typeof baseStroke>): LiveState => ({
      ...initialLiveState,
      session: { workout_id: 'W1', rower_id: 'R1' } as any,
      stroke: { ...baseStroke, ...s },
    })

    const cross = makeState({ time_sec: 100, distance_m: 500, power_w: 300, spm: 28, pace_sec_per_500m: 100 })
    const { container, rerender } = render(<RaceLiveView liveState={cross} totalMeters={500} />)
    const distLeftAtHorn = container.querySelector('[data-component="stat-bar"]')!.textContent
    const elapsedAtHorn = container.querySelector('[data-testid="statbar-elapsed"]')!.textContent
    const userDistAtHorn = container.querySelector('[data-component="race-canvas"]')!.getAttribute('data-user-distance-m')
    expect(userDistAtHorn).toBe('500')
    // 100 s → 1:40
    expect(elapsedAtHorn).toBe('1:40')

    // Post-horn paddle-down stroke: numbers must NOT change.
    const later = makeState({ time_sec: 160, distance_m: 600, power_w: 90, spm: 18, pace_sec_per_500m: 170 })
    rerender(<RaceLiveView liveState={later} totalMeters={500} />)
    expect(container.querySelector('[data-component="stat-bar"]')!.textContent).toBe(distLeftAtHorn)
    expect(container.querySelector('[data-testid="statbar-elapsed"]')!.textContent).toBe(elapsedAtHorn)
    expect(container.querySelector('[data-component="race-canvas"]')!.getAttribute('data-user-distance-m')).toBe('500')
  })

  it('0019-06: user sprite stays pinned at centerX across post-horn paddle-down strokes (no drift off right edge)', () => {
    vi.spyOn(dataHook, 'useRaceData').mockReturnValue(fakeOpps as any)
    vi.spyOn(motionHook, 'useReducedMotion').mockReturnValue(false)
    // Tablet-width viewport so RaceCanvas computes non-zero centerX.
    class RO {
      cb: any
      constructor(cb: any) { this.cb = cb }
      observe(_el: Element) {
        this.cb([{ contentRect: { width: 1024, height: 600 } }])
      }
      unobserve() {}
      disconnect() {}
    }
    ;(globalThis as any).ResizeObserver = RO
    const baseStroke = {
      session_id: 's1', stroke: 1, time_sec: 0, distance_m: 0, spm: 0, power_w: 0,
      cal_per_hr: 0, level: 0, dps: 0, stroke_cycle_sec: 0, pace_sec_per_500m: 0,
      energy_joules: 0, work_distance_m: 0, work_time_sec: 0, phase_distance_m: 0, phase_time_sec: 0,
    }
    const makeState = (s: Partial<typeof baseStroke>): LiveState => ({
      ...initialLiveState,
      session: { workout_id: 'W1', rower_id: 'R1' } as any,
      stroke: { ...baseStroke, ...s },
    })

    // Cross the finish horn at exactly 500 m.
    const cross = makeState({ stroke: 5, time_sec: 100, distance_m: 500, power_w: 300, spm: 28, pace_sec_per_500m: 100 })
    const { container, rerender } = render(<RaceLiveView liveState={cross} totalMeters={500} />)

    const initialBoat = container.querySelector('[data-testid="boat-user"]') as HTMLElement | null
    expect(initialBoat).toBeTruthy()
    const initialLeft = initialBoat!.style.left
    expect(initialLeft).not.toBe('')

    // Strokes 6..15: paddle-down ramps cumulative distance 510 → 600 m
    // across ~60 s. The user sprite must remain pinned (freeze) and on-screen.
    for (let i = 6; i <= 15; i++) {
      const dist = 500 + (i - 5) * 10 // 510, 520, ..., 600
      const tSec = 100 + (i - 5) * 6
      const next = makeState({ stroke: i, time_sec: tSec, distance_m: dist, power_w: 80, spm: 16, pace_sec_per_500m: 180 })
      rerender(<RaceLiveView liveState={next} totalMeters={500} />)

      const boat = container.querySelector('[data-testid="boat-user"]') as HTMLElement | null
      // AC: data-testid="boat-user" present after each post-horn stroke
      expect(boat, `boat-user missing at stroke ${i}`).toBeTruthy()
      // AC: left does not change post-freeze
      expect(boat!.style.left, `boat-user left drifted at stroke ${i}`).toBe(initialLeft)
      // AC: left value is within canvas viewport (1024 px wide).
      // Parse "<n>px" → number; assert 0 ≤ left ≤ viewportWidth.
      const leftPx = Number.parseFloat(boat!.style.left)
      expect(leftPx).toBeGreaterThanOrEqual(0)
      expect(leftPx).toBeLessThanOrEqual(1024)
      // Also confirm freeze on the canvas data attribute.
      expect(container.querySelector('[data-component="race-canvas"]')!.getAttribute('data-user-distance-m')).toBe('500')
    }

    ;(globalThis as any).ResizeObserver = ResizeObserverStub
  })

  it('elapsed cell renders in tablet layout too (data-variant=tablet)', () => {
    vi.spyOn(dataHook, 'useRaceData').mockReturnValue(fakeOpps as any)
    vi.spyOn(motionHook, 'useReducedMotion').mockReturnValue(false)
    // Force tablet width by stubbing ResizeObserver to deliver >= 768
    class RO {
      cb: any
      constructor(cb: any) { this.cb = cb }
      observe(_el: Element) {
        // jsdom: synthesise a contentRect ≥ 768
        this.cb([{ contentRect: { width: 1024, height: 600 } }])
      }
      unobserve() {}
      disconnect() {}
    }
    ;(globalThis as any).ResizeObserver = RO
    const baseStroke = {
      session_id: 's1', stroke: 1, time_sec: 0, distance_m: 0, spm: 0, power_w: 0,
      cal_per_hr: 0, level: 0, dps: 0, stroke_cycle_sec: 0, pace_sec_per_500m: 0,
      energy_joules: 0, work_distance_m: 0, work_time_sec: 0, phase_distance_m: 0, phase_time_sec: 0,
    }
    const state: LiveState = {
      ...initialLiveState,
      session: { workout_id: 'W1', rower_id: 'R1' } as any,
      stroke: { ...baseStroke, time_sec: 65, distance_m: 200, power_w: 250, spm: 22, pace_sec_per_500m: 108 },
    }
    const { container } = render(<RaceLiveView liveState={state} totalMeters={2000} />)
    const tabletBar = container.querySelector('[data-variant="tablet"]')
    expect(tabletBar).toBeTruthy()
    expect(container.querySelector('[data-testid="statbar-elapsed"]')!.textContent).toBe('1:05')
    // Restore stub
    ;(globalThis as any).ResizeObserver = ResizeObserverStub
  })
})
