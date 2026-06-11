import type { LiveState } from './reducer'

// Frame-arrival gap treated as a pause; use for reducer gap detection and
// also hero dead-reckoning freezes.
// Must match smoothingConfig.deadReckoning.pauseThresholdMs (smoothing.ts)
// and LivePacePauseThreshold on the backend (livePace.go).
export const PAUSE_GAP_MS = 4_000

// Per-metric plausible ranges. Samples outside these are dropped before
// they can corrupt sparklines, axis bounds, or the running average.
export const PLAUSIBLE = {
  watts: { min: 30, max: 1500 },
  split: { min: 60, max: 240 },
  spm: { min: 12, max: 50 },
  dps: { min: 3, max: 25 },
} as const

export type PlausibilityKey = keyof typeof PLAUSIBLE

export function isPlausible(v: number | null | undefined, key: PlausibilityKey): boolean {
  if (v === null || v === undefined || !Number.isFinite(v)) return false
  const r = PLAUSIBLE[key]
  return v >= r.min && v <= r.max
}

/**
 * True when the user is likely not actively rowing right now.
 * OR of three signals: long frame-arrival gap, excessive stroke cycle,
 * or SPM below the plausibility floor.
 */
export function isPaused(state: LiveState, nowMs: number = Date.now()): boolean {
  const last = state.lastStrokeReceivedAtMs
  if (last !== null && nowMs - last > PAUSE_GAP_MS) return true
  const s = state.stroke
  if (!s) return false
  if (s.stroke_cycle_sec && s.stroke_cycle_sec > 4) return true
  if (s.spm < PLAUSIBLE.spm.min) return true
  return false
}
