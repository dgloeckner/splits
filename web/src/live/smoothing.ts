/**
 * Single source of truth for all live-view smoothing parameters.
 *
 * See specs/feat/0001b-live-view-smoothing.md for the rationale behind
 * each constant. Any tuning should happen here, not in the consumers.
 */
export const smoothingConfig = {
  ema: {
    watts: { alpha: 0.5, hysteresis: 3 }, // W
    // Split EMA relaxed to 1.0 (pass-through) per ADR-0011 / FEAT-0015
    // Slice 5: the backend now ships a 5-second windowed split, which
    // is the smoother. Stacking an EMA on top adds lag without removing
    // any meaningful noise. Sparkline buffer for split is unchanged.
    split: { alpha: 1.0, hysteresis: 0.1 }, // seconds on pace_sec_per_500m
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
  /** Duration (ms) for hero number count-up tween. 0 = instant snap. */
  countUpMs: 0,
} as const

export type SmoothingConfig = typeof smoothingConfig
