import { render, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as any).ResizeObserver = ResizeObserverStub
if (typeof (globalThis as any).cancelAnimationFrame !== 'function') {
  ;(globalThis as any).cancelAnimationFrame = () => {}
}
if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
  ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now ? performance.now() : 0), 0) as unknown as number
  }
}

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

  it('AbortControl pill is rendered on Bereit', () => {
    vi.spyOn(dataHook, 'useRaceData').mockReturnValue(fakeOpps as any)
    const { getByTestId } = render(
      <RaceFlow liveState={baseLive} totalMeters={2000} opponentsLabel="Ghost · PB" />,
    )
    expect(getByTestId('abort-pill')).toBeTruthy()
  })

  it('AbortControl pill is rendered on Ceremony and remains tappable above the overlay', () => {
    vi.spyOn(dataHook, 'useRaceData').mockReturnValue(fakeOpps as any)
    const rafCallbacks: FrameRequestCallback[] = []
    ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    }
    ;(globalThis as any).cancelAnimationFrame = () => {}
    let now = 0
    vi.stubGlobal('performance', { now: () => now } as any)
    function pumpRaf(toMs: number) {
      now = toMs
      act(() => {
        const cbs = rafCallbacks.splice(0)
        cbs.forEach((cb) => cb(now))
      })
    }

    const { getByTestId } = render(
      <RaceFlow liveState={baseLive} totalMeters={2000} opponentsLabel="" />,
    )
    act(() => { fireEvent.click(getByTestId('bereit-button')) })
    pumpRaf(100) // ATTENTION
    act(() => { vi.advanceTimersByTime(0) })

    const pill = getByTestId('abort-pill')
    expect(pill).toBeTruthy()
    // Pill z-index must exceed RaceStartSequence overlay (z-index: 10).
    // We assert via the host wrapper's inline style (JSDOM-friendly).
    const host = pill.closest('[data-testid="abort-control"]') as HTMLElement | null
    expect(host).not.toBeNull()
    const wrapperZ = parseInt(host!.style.zIndex || '0', 10)
    expect(wrapperZ).toBeGreaterThan(10)
  })

  it('AbortControl pill is rendered on Live but absent on Finished and Post (PRD-0017 / 0017-02 Option A)', () => {
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
    pumpRaf(4500) // Live

    expect(queryByTestId('abort-pill')).not.toBeNull()

    // Finish-cross → Finished. Per PRD-0017 / 0017-02 (Option A) the
    // Abbrechen pill is hidden once the finish horn fires: the result
    // is latched and abort is unavailable (see CONTEXT.md §Pause/Abort).
    liveState = { ...baseLive, stroke: { time_sec: 470, distance_m: 2000, pace_sec_per_500m: 118, power_w: 280, spm: 32 } }
    rerender(<RaceFlow liveState={liveState} totalMeters={2000} opponentsLabel="" />)
    expect(queryByTestId('finish-overlay')).not.toBeNull()
    expect(queryByTestId('abort-pill')).toBeNull()

    // Session ends → Post
    liveState = {
      ...baseLive,
      stroke: liveState.stroke,
      summary: { duration_sec: 470, total_distance_m: 2000, race: null },
    }
    rerender(<RaceFlow liveState={liveState} totalMeters={2000} opponentsLabel="" />)
    // We're on Post — pill must be absent.
    expect(queryByTestId('abort-pill')).toBeNull()
  })

  it('From Ceremony: tap pill → confirm → reducer transitions to Aborted (race surface unmounts)', () => {
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

    const { getByTestId, queryByTestId } = render(
      <RaceFlow liveState={baseLive} totalMeters={2000} opponentsLabel="" />,
    )
    act(() => { fireEvent.click(getByTestId('bereit-button')) })
    pumpRaf(100) // ATTENTION
    act(() => { vi.advanceTimersByTime(0) })

    // Sanity: canvas + overlay present.
    expect(document.querySelector('[data-component="race-canvas"]')).not.toBeNull()
    expect(document.querySelector('[role="status"][aria-live="assertive"]')).not.toBeNull()

    // Tap pill → confirm sheet appears.
    act(() => { fireEvent.click(getByTestId('abort-pill')) })
    expect(getByTestId('abort-confirm-sheet')).toBeTruthy()

    // Confirm → reducer transitions to Aborted; race surface unmounts.
    act(() => { fireEvent.click(getByTestId('abort-confirm-confirm')) })
    expect(queryByTestId('abort-pill')).toBeNull()
    expect(document.querySelector('[data-component="race-canvas"]')).toBeNull()
    expect(document.querySelector('[role="status"][aria-live="assertive"]')).toBeNull()
  })

  it('Confirm invokes the onAbort prop (caller wires session-end via useWorkoutOverlay.abort)', () => {
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

    const onAbort = vi.fn()
    const { getByTestId } = render(
      <RaceFlow liveState={baseLive} totalMeters={2000} opponentsLabel="" onAbort={onAbort} />,
    )
    act(() => { fireEvent.click(getByTestId('bereit-button')) })
    pumpRaf(100)
    act(() => { fireEvent.click(getByTestId('abort-pill')) })
    act(() => { fireEvent.click(getByTestId('abort-confirm-confirm')) })
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  it('Cancel path: tap pill → cancel → reducer state unchanged; canvas + overlay intact', () => {
    vi.spyOn(dataHook, 'useRaceData').mockReturnValue(fakeOpps as any)
    const rafCallbacks: FrameRequestCallback[] = []
    ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    }
    ;(globalThis as any).cancelAnimationFrame = () => {}
    let now = 0
    vi.stubGlobal('performance', { now: () => now } as any)
    function pumpRaf(toMs: number) {
      now = toMs
      act(() => {
        const cbs = rafCallbacks.splice(0)
        cbs.forEach((cb) => cb(now))
      })
    }

    const { getByTestId, queryByTestId } = render(
      <RaceFlow liveState={baseLive} totalMeters={2000} opponentsLabel="" />,
    )
    act(() => { fireEvent.click(getByTestId('bereit-button')) })
    pumpRaf(100) // ATTENTION
    act(() => { vi.advanceTimersByTime(0) })

    const overlayBefore = document.querySelector('[role="status"][aria-live="assertive"]')
    expect(overlayBefore).not.toBeNull()

    act(() => { fireEvent.click(getByTestId('abort-pill')) })
    act(() => { fireEvent.click(getByTestId('abort-confirm-cancel')) })

    // Sheet closed, pill still present, canvas + ceremony overlay still mounted.
    expect(queryByTestId('abort-confirm-sheet')).toBeNull()
    expect(queryByTestId('abort-pill')).not.toBeNull()
    expect(document.querySelector('[data-component="race-canvas"]')).not.toBeNull()
    expect(document.querySelector('[role="status"][aria-live="assertive"]')).not.toBeNull()
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

  // 0019-03: explicit Fertig affordance plumbed through RaceFlow.
  it('Finished: tapping FinishOverlay Fertig invokes the onFinish prop exactly once', () => {
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

    const onFinish = vi.fn()
    let liveState: any = { ...baseLive, stroke: null }
    const { getByTestId, rerender, queryByTestId } = render(
      <RaceFlow
        liveState={liveState}
        totalMeters={2000}
        opponentsLabel=""
        onFinish={onFinish}
      />,
    )
    act(() => { fireEvent.click(getByTestId('bereit-button')) })
    pumpRaf(0)
    pumpRaf(1500)
    pumpRaf(3000)
    pumpRaf(4500)

    // Finish-cross
    liveState = { ...baseLive, stroke: { time_sec: 470, distance_m: 2000, pace_sec_per_500m: 118, power_w: 280, spm: 32 } }
    rerender(
      <RaceFlow
        liveState={liveState}
        totalMeters={2000}
        opponentsLabel=""
        onFinish={onFinish}
      />,
    )

    // FinishOverlay + Fertig button present and enabled immediately on mount.
    expect(getByTestId('finish-overlay')).toBeTruthy()
    const fertig = getByTestId('finish-fertig') as HTMLButtonElement
    expect(fertig.disabled).toBe(false)
    // No "Paddelst aus" text in the rendered overlay (0019-03 polish).
    expect(getByTestId('finish-overlay').textContent ?? '').not.toMatch(/Paddelst aus/i)

    act(() => { fireEvent.click(fertig) })
    expect(onFinish).toHaveBeenCalledTimes(1)
    // Race surface (RaceFlow alone) does NOT auto-dismiss on Fertig —
    // dismissal is driven by the caller's session_end flow, which
    // surfaces as `liveState.summary` and drives the reducer to Post.
    // Until then the overlay remains so the rower keeps seeing the
    // result.
    expect(queryByTestId('finish-overlay')).not.toBeNull()
  })

  // 0019-02: idle-timeout / backend session_end during Finished must
  // NOT collapse the race surface — the StatBar + Canvas freeze and
  // the FinishOverlay are designed to stay visible across the
  // paddle-down. Only Fertig (or abort / navigation) advances Finished
  // → Post. The PacingFast E2E fixture demonstrates this: the backend
  // fires session_end within milliseconds of the horn, and we still
  // need to keep showing the result.
  it('Post-finish session_end does NOT auto-dismiss the FinishOverlay — Fertig is the only Finished → Post path (0019-02)', () => {
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

    const onFinish = vi.fn()
    let liveState: any = { ...baseLive, stroke: null }
    const { getByTestId, rerender, queryByTestId } = render(
      <RaceFlow
        liveState={liveState}
        totalMeters={2000}
        opponentsLabel=""
        onFinish={onFinish}
      />,
    )
    act(() => { fireEvent.click(getByTestId('bereit-button')) })
    pumpRaf(0)
    pumpRaf(1500)
    pumpRaf(3000)
    pumpRaf(4500)

    // Finish-cross → Finished + FinishOverlay
    liveState = { ...baseLive, stroke: { time_sec: 470, distance_m: 2000, pace_sec_per_500m: 118, power_w: 280, spm: 32 } }
    rerender(
      <RaceFlow
        liveState={liveState}
        totalMeters={2000}
        opponentsLabel=""
        onFinish={onFinish}
      />,
    )
    expect(getByTestId('finish-overlay')).toBeTruthy()

    // Rower walks away. Idle-timeout backend fires session_end; the
    // caller's reducer surfaces `summary` on liveState — no Fertig
    // tap occurred.
    liveState = {
      ...baseLive,
      stroke: liveState.stroke,
      summary: { duration_sec: 470, total_distance_m: 2000, race: null },
    }
    rerender(
      <RaceFlow
        liveState={liveState}
        totalMeters={2000}
        opponentsLabel=""
        onFinish={onFinish}
      />,
    )

    // FinishOverlay remains visible — the freeze persists. onFinish
    // must NOT have been invoked because the user never tapped Fertig.
    expect(queryByTestId('finish-overlay')).not.toBeNull()
    expect(onFinish).not.toHaveBeenCalled()
  })
})
