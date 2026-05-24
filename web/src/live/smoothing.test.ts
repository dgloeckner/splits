import { describe, it, expect } from 'vitest'
import { smoothingConfig } from './smoothing'

describe('smoothingConfig', () => {
  it('passes raw device values through; only SPI is EMA-smoothed', () => {
    // Methodology (2026-05): every metric the device emits directly is
    // pass-through to match the rower console exactly. Display-layer
    // hysteresis still absorbs sub-unit wiggles.
    expect(smoothingConfig.ema.watts.alpha).toBe(1.0)
    expect(smoothingConfig.ema.watts.hysteresis).toBe(3)
    expect(smoothingConfig.ema.split.alpha).toBe(1.0)
    expect(smoothingConfig.ema.split.hysteresis).toBeCloseTo(0.1)
    expect(smoothingConfig.ema.spm.alpha).toBe(1.0)
    expect(smoothingConfig.ema.spm.hysteresis).toBe(0.5)
    expect(smoothingConfig.ema.dps.alpha).toBe(1.0)
    expect(smoothingConfig.ema.dps.hysteresis).toBeCloseTo(0.05)
    // SPI keeps its EMA: derived (watts/SPM) so it inherits compound noise.
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
