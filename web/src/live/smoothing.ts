/**
 * Single source of truth for all live-view smoothing parameters.
 *
 * Methodology (2026-05): every metric the device emits directly
 * (watts, SPM, DPS, split-pace) is now pass-through. The rower's LCD
 * already shows the values we receive, and stacking an EMA on top
 * introduced 1–2 strokes of visible lag versus the console. Only SPI
 * (derived = watts/SPM) keeps its EMA, since it inherits noise from
 * two independent inputs. The `alpha` field is therefore unused for
 * watts/SPM/DPS/split and kept only so the hysteresis values can sit
 * next to the metric they belong to.
 *
 * Hysteresis remains active at the display layer (useLiveDisplay) —
 * it's presentational, preventing ±1 W jitter from twitching the
 * rendered integer between effectively-identical strokes.
 */
export const smoothingConfig = {
  ema: {
    watts: { alpha: 1.0, hysteresis: 3 }, // W — pass-through; hysteresis only
    split: { alpha: 1.0, hysteresis: 0.1 }, // s/500m — pass-through; device split is already smoothed
    spm: { alpha: 1.0, hysteresis: 0.5 }, // pass-through; hysteresis only
    dps: { alpha: 1.0, hysteresis: 0.05 }, // m — pass-through; hysteresis only
    spi: { alpha: 0.3, hysteresis: 0.05 }, // W/stroke — derived; EMA dampens compound noise
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
