import { describe, it, expect } from 'vitest'
import { smoothingConfig } from './smoothing'

describe('smoothingConfig', () => {
  it('exposes EMA alpha/hysteresis for each tracked metric', () => {
    expect(smoothingConfig.ema.watts.alpha).toBe(0.5)
    expect(smoothingConfig.ema.watts.hysteresis).toBe(3)
    // Split EMA is pass-through (alpha=1.0): the backend now smooths
    // via a 5 s window (ADR-0011 / FEAT-0015 Slice 5).
    expect(smoothingConfig.ema.split.alpha).toBe(1.0)
    expect(smoothingConfig.ema.split.hysteresis).toBeCloseTo(0.1)
    expect(smoothingConfig.ema.spm.alpha).toBe(0.4)
    expect(smoothingConfig.ema.spm.hysteresis).toBe(0.5)
    expect(smoothingConfig.ema.dps.alpha).toBe(0.3)
    expect(smoothingConfig.ema.spi.alpha).toBe(0.3)
  })

  it('exposes a dead-reckoning pause threshold', () => {
    expect(smoothingConfig.deadReckoning.pauseThresholdMs).toBe(4000)
  })

  it('exposes sparkline window sizes per viewport class', () => {
    expect(smoothingConfig.sparkline.windowSeconds.phone).toBe(90)
    expect(smoothingConfig.sparkline.windowSeconds.tablet).toBe(120)
  })

  it('defines cold-start and count-up durations', () => {
    expect(smoothingConfig.coldStartSeconds).toBe(5)
    expect(smoothingConfig.countUpMs).toBe(0)
  })
})
