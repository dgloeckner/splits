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

  it('finish-cross renders FinishOverlay over the canvas; canvas stays mounted; latched values stable across subsequent strokes', () => {
    vi.spyOn(dataHook, 'useRaceData').mockReturnValue(fakeOpps as any)
    const rafCallbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    let now = 0
    vi.stubGlobal('performance', { now: () => now } as any)

    function pumpRaf(toMs: number) {
      now = toMs
      act(() => {
        const cbs = rafCallbacks.splice(0)
        cbs.forEach((cb) => cb(now))
      })
    }

    let liveState: any = { ...baseLive, stroke: null }
    const { getByTestId, queryByTestId, rerender } = render(
      <RaceFlow liveState={liveState} totalMeters={2000} opponentsLabel="" />,
    )
    act(() => { fireEvent.click(getByTestId('bereit-button')) })
    pumpRaf(0)
    pumpRaf(1500)
    pumpRaf(3000)
    pumpRaf(4500)

    // Finish-cross stroke
    liveState = { ...baseLive, stroke: { time_sec: 470, distance_m: 2000, pace_sec_per_500m: 118, power_w: 280, spm: 32 } }
    rerender(<RaceFlow liveState={liveState} totalMeters={2000} opponentsLabel="" />)

    expect(getByTestId('finish-overlay')).toBeTruthy()
    // Canvas must still be mounted under the overlay
    expect(document.querySelector('[data-component="race-canvas"]')).not.toBeNull()
    const time0 = getByTestId('finish-time').textContent

    // Additional "paddle-out" strokes — overlay values must NOT change
    liveState = { ...baseLive, stroke: { time_sec: 480, distance_m: 2010, pace_sec_per_500m: 119, power_w: 250, spm: 30 } }
    rerender(<RaceFlow liveState={liveState} totalMeters={2000} opponentsLabel="" />)
    expect(getByTestId('finish-overlay')).toBeTruthy()
    expect(getByTestId('finish-time').textContent).toBe(time0)
    // Canvas still mounted
    expect(document.querySelector('[data-component="race-canvas"]')).not.toBeNull()
    // queryByTestId still finds it
    expect(queryByTestId('finish-overlay')).not.toBeNull()
  })

  it('Bereit tap → ATTENTION → SET → GO!; canvas mounts at ATTENTION (ADR-0013)', () => {
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

    // Pre-Bereit: useRaceData NOT called (Bereit still does not open fetch).
    expect(spy).not.toHaveBeenCalled()

    // Tap Bereit at t=0
    act(() => {
      fireEvent.click(getByTestId('bereit-button'))
    })
    // ATTENTION should be showing AND canvas is mounted now (ADR-0013).
    pumpRaf(100)
    act(() => { vi.advanceTimersByTime(0) })
    expect(queryByTestId('bereit-screen')).toBeNull()
    expect(spy).toHaveBeenCalled()
    const canvasAtAttention = document.querySelector('[data-component="race-canvas"]')
    expect(canvasAtAttention).not.toBeNull()
    // Ceremony overlay is rendered (above the canvas in DOM order, z-index 10).
    expect(document.querySelector('[role="status"][aria-live="assertive"]')).not.toBeNull()

    // Advance to SET (>= 1500ms) — canvas stays mounted (same DOM node).
    pumpRaf(1500)
    act(() => { vi.advanceTimersByTime(1500) })
    const canvasAtSet = document.querySelector('[data-component="race-canvas"]')
    expect(canvasAtSet).toBe(canvasAtAttention)
    // Ceremony overlay still present at SET.
    expect(document.querySelector('[role="status"][aria-live="assertive"]')).not.toBeNull()

    // Advance to GO (>= 3000ms) — canvas still same node.
    pumpRaf(3000)
    act(() => { vi.advanceTimersByTime(1500) })
    const canvasAtGo = document.querySelector('[data-component="race-canvas"]')
    expect(canvasAtGo).toBe(canvasAtAttention)

    // Advance past GO+1500 to Live — canvas remains, ceremony overlay gone.
    pumpRaf(4500)
    act(() => { vi.advanceTimersByTime(1500) })
    const canvasAtLive = document.querySelector('[data-component="race-canvas"]')
    expect(canvasAtLive).toBe(canvasAtAttention)
    expect(document.querySelector('[role="status"][aria-live="assertive"]')).toBeNull()
  })

  it('Falschstart: stroke during ATTENTION → Live(falschstart); visible boat stays at 0', () => {
    vi.spyOn(dataHook, 'useRaceData').mockReturnValue(fakeOpps as any)
    const rafCallbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    let now = 0
    vi.stubGlobal('performance', { now: () => now } as any)

    function pumpRaf(toMs: number) {
      now = toMs
      act(() => {
        const cbs = rafCallbacks.splice(0)
        cbs.forEach((cb) => cb(now))
      })
    }

    let liveState: any = { ...baseLive, stroke: null }
    const { getByTestId, rerender } = render(
      <RaceFlow liveState={liveState} totalMeters={2000} opponentsLabel="" />,
    )
    act(() => { fireEvent.click(getByTestId('bereit-button')) })
    pumpRaf(100) // ATTENTION

    // Stroke arrives during ATTENTION: time_sec is well before race_t0 (ms).
    liveState = {
      ...baseLive,
      stroke: { time_sec: 0.5, distance_m: 3, pace_sec_per_500m: 130, power_w: 100, spm: 20 },
    }
    rerender(<RaceFlow liveState={liveState} totalMeters={2000} opponentsLabel="" />)

    // Reducer should have transitioned to Live(Falschstart); FalschstartToast visible.
    expect(document.querySelector('[data-testid="falschstart-toast"]')).not.toBeNull()

    // The visible userDistanceM passed to RaceCanvas must read 0, not 3.
    const canvas = document.querySelector('[data-component="race-canvas"]')
    expect(canvas).not.toBeNull()
    expect(canvas?.getAttribute('data-user-distance-m')).toBe('0')
  })
})
