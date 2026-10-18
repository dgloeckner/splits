import { useEffect, useRef, useState } from 'react'
import type { LiveState, SmoothedValues } from './reducer'
import { smoothingConfig } from './smoothing'
import { applyHysteresis } from './ema'
import { fmtInt, fmtFloat, mmssWhole, pace500m } from '../util/format'

/** True when the user has requested reduced motion via OS/browser prefs. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    // Older Safari lacks addEventListener on MQL.
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else mq.addListener(handler)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else mq.removeListener(handler)
    }
  }, [])
  return reduced
}

/** Tracks tab visibility so rAF loops can skip work while hidden. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  )
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

/**
 * rAF ticker that drives a re-render roughly once per frame, only while the
 * tab is visible. Returns the current high-resolution timestamp.
 */
function useFrameTick(enabled: boolean): number {
  const [tick, setTick] = useState(() =>
    typeof performance !== 'undefined' ? performance.now() : 0,
  )
  useEffect(() => {
    if (!enabled) return
    let raf = 0
    const loop = () => {
      setTick(performance.now())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [enabled])
  return tick
}

export type DeadReckoned = { text: string; paused: boolean }

/**
 * Returns true when no stroke has arrived for more than the pause
 * threshold — used to blank hero/tile values so the view doesn't
 * display stale numbers when the rower has stopped.
 */
export function useIsLivePaused(state: LiveState): boolean {
  const reduced = usePrefersReducedMotion()
  const visible = usePageVisible()
  useFrameTick(!reduced && visible)
  // The rAF tick is disabled under reduced-motion / hidden tab, and a
  // pause by definition produces no new strokes — so nothing would
  // ever re-render this hook to flip `paused`. A coarse 1 s interval
  // keeps detection alive without re-enabling animation.
  const [, bump] = useState(0)
  useEffect(() => {
    if (!reduced && visible) return
    const id = setInterval(() => bump((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [reduced, visible])
  if (state.serverPaused) return true
  const last = state.lastStrokeReceivedAtMs
  if (last === null) return true
  // Reading the wall clock while rendering is the point of this hook: the
  // frame tick or the interval above re-renders it so the read is fresh.
  // eslint-disable-next-line react-hooks/purity
  return Date.now() - last >= smoothingConfig.deadReckoning.pauseThresholdMs
}

type Extrapolated = { value: number | null; paused: boolean }

/**
 * Numeric core of the time dead-reckoning. Returns absolute extrapolated
 * timeSec since session start. Use the formatting wrappers below for
 * display.
 */
export function useExtrapolatedTimeSec(state: LiveState): Extrapolated {
  const reduced = usePrefersReducedMotion()
  const visible = usePageVisible()
  useFrameTick(!reduced && visible)

  const s = state.stroke
  if (!s) return { value: null, paused: false }

  // Reading the wall clock while rendering is the point of this hook: the
  // frame tick above re-renders it every frame so the read is fresh.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const receivedAt = state.lastStrokeReceivedAtMs ?? now
  const sinceFrame = now - receivedAt
  const paused = sinceFrame >= smoothingConfig.deadReckoning.pauseThresholdMs

  if (reduced || !visible || paused) {
    return { value: s.time_sec, paused }
  }
  return { value: s.time_sec + sinceFrame / 1000, paused: false }
}

/**
 * Returns the displayed elapsed time as mm:ss, extrapolated between
 * strokes using wall-clock deltas. Freezes when stroke frames stop
 * arriving for more than `pauseThresholdMs`.
 */
export function useDeadReckonedTime(state: LiveState): DeadReckoned {
  const e = useExtrapolatedTimeSec(state)
  return { text: mmssWhole(e.value), paused: e.paused }
}

/**
 * Numeric core of distance dead-reckoning. Returns absolute extrapolated
 * distance in meters since session start.
 *
 * Speed source: the smoothed split (`state.smoothed.paceSecPer500m`),
 * preferred over a two-stroke Δm/Δs delta because boat velocity surges
 * within each stroke cycle (peak mid-drive, valley during recovery), so
 * the per-pair delta jumps as cadence/power varies. The smoothed split is
 * a pass-through of the rower's wire value (alpha = 1.0) so it reflects
 * the device's own smoothing without adding lag.
 * Falls back to the current stroke's dps / stroke_cycle_sec when the
 * smoothed split isn't yet available (cold start).
 */
export function useExtrapolatedDistanceM(state: LiveState): Extrapolated {
  const reduced = usePrefersReducedMotion()
  const visible = usePageVisible()
  useFrameTick(!reduced && visible)

  const s = state.stroke
  if (!s) return { value: null, paused: false }

  // Reading the wall clock while rendering is the point of this hook: the
  // frame tick above re-renders it every frame so the read is fresh.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const receivedAt = state.lastStrokeReceivedAtMs ?? now
  const sinceFrame = now - receivedAt
  const paused = sinceFrame >= smoothingConfig.deadReckoning.pauseThresholdMs

  if (reduced || !visible || paused) {
    return { value: s.distance_m, paused }
  }
  let speed = 0
  const emaPace = state.smoothed?.paceSecPer500m ?? null
  if (emaPace !== null && emaPace > 0) {
    speed = 500 / emaPace
  } else if (s.stroke_cycle_sec > 0) {
    speed = s.dps / s.stroke_cycle_sec
  }
  return { value: s.distance_m + speed * (sinceFrame / 1000), paused: false }
}

/**
 * Returns the displayed distance as an integer meters string, extrapolated
 * using the speed derived from the last two frames (Δm/Δs).
 */
export function useDeadReckonedDistance(state: LiveState): DeadReckoned {
  const e = useExtrapolatedDistanceM(state)
  return { text: fmtInt(e.value), paused: e.paused }
}

/**
 * Phase-aware distance display. Uses the backend-stamped `phase_distance_m`
 * from the latest stroke as the base value, then adds the dead-reckoned
 * extrapolation delta on top so the counter ticks smoothly between strokes.
 * Returns 0 when no stroke has arrived yet.
 */
export function usePhasedDistance(state: LiveState): DeadReckoned {
  const e = useExtrapolatedDistanceM(state)
  const s = state.stroke
  if (e.value === null || s === null) return { text: fmtInt(null), paused: e.paused }
  const base = s.phase_distance_m
  const delta = Math.max(0, e.value - s.distance_m)
  return { text: fmtInt(base + delta), paused: e.paused }
}

/**
 * Phase-aware time display. Uses the backend-stamped `phase_time_sec` from
 * the latest stroke as the base value, then adds the dead-reckoned
 * extrapolation delta on top so the timer ticks smoothly between strokes.
 * Returns '—' when no stroke has arrived yet.
 */
export function usePhasedTime(state: LiveState): DeadReckoned {
  const e = useExtrapolatedTimeSec(state)
  const s = state.stroke
  if (e.value === null || s === null) return { text: mmssWhole(null), paused: e.paused }
  const base = s.phase_time_sec
  const delta = Math.max(0, e.value - s.time_sec)
  return { text: mmssWhole(base + delta), paused: e.paused }
}

export type SmoothedDisplay = {
  watts: string
  split: string
  spm: string
  dps: string
  spi: string
}

type HeldValues = {
  watts: number | null
  split: number | null
  spm: number | null
  dps: number | null
  spi: number | null
}

const NOTHING_HELD: HeldValues = { watts: null, split: null, spm: null, dps: null, spi: null }

/**
 * The value to hold after seeing `candidate`: the first value is taken as
 * is, a later one replaces the held value only once it moves by at least
 * `threshold`, and a null candidate keeps whatever was held.
 */
function hold(held: number | null, candidate: number | null, threshold: number): number | null {
  if (candidate === null) return held
  return held === null ? candidate : applyHysteresis(held, candidate, threshold)
}

/**
 * Formats the reducer's smoothed values for display, applying hysteresis at
 * the *display* layer so tiny wiggles don't flicker the DOM.
 * Falls back to em-dash while smoothed is null (pre-first-stroke).
 */
export function useSmoothed(state: LiveState): SmoothedDisplay {
  const sm = state.smoothed
  // The held values, and the smoothed frame they were last moved by. They
  // are updated while rendering, React's pattern for state that follows a
  // changing input: the hook re-renders at once with the new values,
  // before anything is painted, and a re-render of the same frame (every
  // animation tick) leaves them alone.
  const [held, setHeld] = useState<{ from: SmoothedValues | null; values: HeldValues }>({
    from: null,
    values: NOTHING_HELD,
  })
  let values = held.values
  if (sm && sm !== held.from) {
    const h = smoothingConfig.ema
    values = {
      watts: hold(values.watts, sm.power, h.watts.hysteresis),
      split: hold(values.split, sm.paceSecPer500m, h.split.hysteresis),
      spm: hold(values.spm, sm.spm, h.spm.hysteresis),
      dps: hold(values.dps, sm.dps, h.dps.hysteresis),
      spi: hold(values.spi, sm.spi, h.spi.hysteresis),
    }
    setHeld({ from: sm, values })
  }

  if (!sm) {
    return { watts: '—', split: '—', spm: '—', dps: '—', spi: '—' }
  }
  return {
    watts: fmtInt(sm.power === null ? null : values.watts),
    split: pace500m(sm.paceSecPer500m === null ? null : values.split),
    spm: fmtInt(sm.spm === null ? null : values.spm),
    dps: fmtFloat(sm.dps === null ? null : values.dps, 1),
    spi: fmtFloat(sm.spi === null ? null : values.spi, 1),
  }
}

/**
 * Linearly tweens the displayed number toward a new target over
 * `durationMs`. Uses rAF; degrades to an instant snap under
 * `prefers-reduced-motion` or when the tab is hidden.
 *
 * Returns `null` when the target is null.
 */
export function useCountUp(value: number | null, durationMs: number): number | null {
  const reduced = usePrefersReducedMotion()
  const visible = usePageVisible()
  const [displayed, setDisplayed] = useState<number | null>(value)
  const startRef = useRef<number>(0)
  const fromRef = useRef<number>(value ?? 0)
  const toRef = useRef<number | null>(value)
  const rafRef = useRef<number | null>(null)

  // A null target, reduced motion and a hidden tab all snap straight to the
  // target. Snapping while rendering, rather than from the effect below,
  // means the stale number is never painted first.
  const snap = value === null || reduced || !visible
  if (snap && displayed !== value) setDisplayed(value)

  useEffect(() => {
    if (value === null) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      toRef.current = null
      return
    }

    if (toRef.current === value) return
    if (reduced || !visible) {
      toRef.current = value
      fromRef.current = value
      return
    }

    fromRef.current = displayed ?? value
    toRef.current = value
    startRef.current = performance.now()

    const step = () => {
      const now = performance.now()
      const elapsed = now - startRef.current
      const t = Math.min(1, elapsed / durationMs)
      const from = fromRef.current
      const to = toRef.current ?? from
      const cur = from + (to - from) * t
      setDisplayed(cur)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
      }
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // We intentionally only react to value / motion / visibility changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced, visible, durationMs])

  return displayed
}
