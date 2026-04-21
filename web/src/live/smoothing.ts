/**
 * Single source of truth for all live-view smoothing parameters.
 *
 * See specs/feat/0001b-live-view-smoothing.md for the rationale behind
 * each constant. Any tuning should happen here, not in the consumers.
 */
export const smoothingConfig = {
  ema: {
    watts: { alpha: 0.3, hysteresis: 3 }, // W
    split: { alpha: 0.3, hysteresis: 0.1 }, // seconds on pace_sec_per_500m
    spm: { alpha: 0.4, hysteresis: 0.5 },
    dps: { alpha: 0.3, hysteresis: 0.05 }, // m
    spi: { alpha: 0.3, hysteresis: 0.05 }, // W/stroke
  },
  deadReckoning: {
    pauseThresholdMs: 4000,
  },
  sparkline: {
    windowSeconds: { phone: 90, tablet: 120 },
  },
  /** Seconds after session_start during which raw values flow through unsmoothed. */
  coldStartSeconds: 5,
  /** Duration (ms) for hero number count-up tween. */
  countUpMs: 250,
} as const

export type SmoothingConfig = typeof smoothingConfig
