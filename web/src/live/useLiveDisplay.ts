import { useEffect, useRef, useState } from 'react'
import type { LiveState } from './reducer'
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
 * Returns the displayed elapsed time as mm:ss, extrapolated between
 * strokes using wall-clock deltas. Freezes when stroke frames stop
 * arriving for more than `pauseThresholdMs`.
 */
export function useDeadReckonedTime(state: LiveState): DeadReckoned {
  const reduced = usePrefersReducedMotion()
  const visible = usePageVisible()
  useFrameTick(!reduced && visible)

  const s = state.stroke
  if (!s) return { text: mmssWhole(null), paused: false }

  const receivedAt = state.lastStrokeReceivedAtMs ?? Date.now()
  const now = Date.now()
  const sinceFrame = now - receivedAt
  const paused = sinceFrame >= smoothingConfig.deadReckoning.pauseThresholdMs

  if (reduced || !visible || paused) {
    return { text: mmssWhole(s.time_sec), paused }
  }

  const extrapolated = s.time_sec + sinceFrame / 1000
  return { text: mmssWhole(extrapolated), paused: false }
}

/**
 * Returns the displayed distance as an integer meters string, extrapolated
 * using the speed derived from the last two frames (Δm/Δs).
 */
export function useDeadReckonedDistance(state: LiveState): DeadReckoned {
  const reduced = usePrefersReducedMotion()
  const visible = usePageVisible()
  useFrameTick(!reduced && visible)

  // Track the previous-previous stroke so we can derive speed from the last
  // two strokes. When a new stroke number arrives, the CURRENT snapshot
  // becomes "previous" for speed calc.
  const lastSnapshotRef = useRef<{
    stroke: number
    time_sec: number
    distance_m: number
  } | null>(null)
  const prevSnapshotRef = useRef<{ time_sec: number; distance_m: number } | null>(null)
  const s = state.stroke
  useEffect(() => {
    if (!s) return
    const last = lastSnapshotRef.current
    if (last === null || last.stroke !== s.stroke) {
      if (last) {
        prevSnapshotRef.current = { time_sec: last.time_sec, distance_m: last.distance_m }
      }
      lastSnapshotRef.current = {
        stroke: s.stroke,
        time_sec: s.time_sec,
        distance_m: s.distance_m,
      }
    }
  }, [s])

  if (!s) return { text: fmtInt(null), paused: false }

  const receivedAt = state.lastStrokeReceivedAtMs ?? Date.now()
  const now = Date.now()
  const sinceFrame = now - receivedAt
  const paused = sinceFrame >= smoothingConfig.deadReckoning.pauseThresholdMs

  if (reduced || !visible || paused) {
    return { text: fmtInt(s.distance_m), paused }
  }

  let speed = 0
  const prev = prevSnapshotRef.current
  if (prev && s.time_sec > prev.time_sec) {
    speed = (s.distance_m - prev.distance_m) / (s.time_sec - prev.time_sec)
  }

  const extrapolated = s.distance_m + speed * (sinceFrame / 1000)
  return { text: fmtInt(extrapolated), paused: false }
}

export type SmoothedDisplay = {
  watts: string
  split: string
  spm: string
  dps: string
  spi: string
}

/**
 * Formats the reducer's smoothed values for display, applying hysteresis at
 * the *display* layer (via refs) so tiny wiggles don't flicker the DOM.
 * Falls back to em-dash while smoothed is null (pre-first-stroke).
 */
export function useSmoothed(state: LiveState): SmoothedDisplay {
  const wattsRef = useRef<number | null>(null)
  const splitRef = useRef<number | null>(null)
  const spmRef = useRef<number | null>(null)
  const dpsRef = useRef<number | null>(null)
  const spiRef = useRef<number | null>(null)

  const sm = state.smoothed
  if (!sm) {
    return { watts: '—', split: '—', spm: '—', dps: '—', spi: '—' }
  }

  const wattsVal =
    sm.power === null
      ? null
      : wattsRef.current === null
        ? sm.power
        : applyHysteresis(wattsRef.current, sm.power, smoothingConfig.ema.watts.hysteresis)
  if (wattsVal !== null) wattsRef.current = wattsVal

  const splitVal =
    sm.paceSecPer500m === null
      ? null
      : splitRef.current === null
        ? sm.paceSecPer500m
        : applyHysteresis(
            splitRef.current,
            sm.paceSecPer500m,
            smoothingConfig.ema.split.hysteresis,
          )
  if (splitVal !== null) splitRef.current = splitVal

  const spmVal =
    sm.spm === null
      ? null
      : spmRef.current === null
        ? sm.spm
        : applyHysteresis(spmRef.current, sm.spm, smoothingConfig.ema.spm.hysteresis)
  if (spmVal !== null) spmRef.current = spmVal

  const dpsVal =
    sm.dps === null
      ? null
      : dpsRef.current === null
        ? sm.dps
        : applyHysteresis(dpsRef.current, sm.dps, smoothingConfig.ema.dps.hysteresis)
  if (dpsVal !== null) dpsRef.current = dpsVal

  const spiVal =
    sm.spi === null
      ? null
      : spiRef.current === null
        ? sm.spi
        : applyHysteresis(spiRef.current, sm.spi, smoothingConfig.ema.spi.hysteresis)
  if (spiVal !== null) spiRef.current = spiVal

  return {
    watts: fmtInt(wattsVal),
    split: pace500m(splitVal),
    spm: fmtInt(spmVal),
    dps: fmtFloat(dpsVal, 1),
    spi: fmtFloat(spiVal, 1),
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

  useEffect(() => {
    if (value === null) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      setDisplayed(null)
      toRef.current = null
      return
    }

    if (toRef.current === value) return
    if (reduced || !visible) {
      toRef.current = value
      fromRef.current = value
      setDisplayed(value)
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
