import { render, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as any).ResizeObserver = ResizeObserverStub

import { RaceFlow } from './RaceFlow'
import * as dataHook from './useRaceData'
import * as motionHook from './reducedMotion'

const fakeOpps = { ghost: null, pb: null }

const baseLive = {
  session: null,
  stroke: null,
  summary: null,
  phase: 'idle',
} as any

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(motionHook, 'useReducedMotion').mockReturnValue(false)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RaceFlow integration', () => {
  it('renders BereitScreen first; does NOT open live-data subscription before tap', () => {
    const spy = vi.spyOn(dataHook, 'useRaceData').mockReturnValue(fakeOpps as any)
    const { getByTestId, queryByTestId } = render(
      <RaceFlow liveState={baseLive} totalMeters={2000} opponentsLabel="Ghost · PB" />,
    )
    expect(getByTestId('bereit-screen')).toBeTruthy()
    expect(queryByTestId('bereit-button')).not.toBeNull()
    // RaceLiveView (and therefore useRaceData) must not have been
    // mounted before the user taps Bereit.
    expect(spy).not.toHaveBeenCalled()
  })

  it('Bereit tap → ATTENTION → SET → GO!; live view mounts only at GO', () => {
    const spy = vi.spyOn(dataHook, 'useRaceData').mockReturnValue(fakeOpps as any)
    // Drive rAF via fake timers so the lifecycle hook can advance.
    const rafCallbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    let now = 0
    vi.stubGlobal('performance', { now: () => now } as any)

    const { getByTestId, queryByTestId } = render(
      <RaceFlow liveState={baseLive} totalMeters={2000} opponentsLabel="Ghost · PB" />,
    )

    function pumpRaf(toMs: number) {
      now = toMs
      act(() => {
        const cbs = rafCallbacks.splice(0)
        cbs.forEach((cb) => cb(now))
      })
    }

    // Tap Bereit at t=0
    act(() => {
      fireEvent.click(getByTestId('bereit-button'))
    })
    // ATTENTION should be showing
    pumpRaf(100)
    expect(queryByTestId('bereit-screen')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    // Advance to SET (>= 1500ms)
    pumpRaf(1500)
    // Advance to GO (>= 3000ms) — live view mounts
    pumpRaf(3000)
    expect(spy).toHaveBeenCalled()
    // Advance past GO+1500 to Live
    pumpRaf(4500)
  })
})
