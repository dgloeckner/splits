import { describe, it, expect } from 'vitest'
import type { Finding } from '../../api/insights'
import type { SessionSamples } from '../../api/client'
import { findingVisual, findingWindow } from './findingVisuals'

const sample = (i: number, pace: number, watt: number) => ({
  stroke_no: i + 1, time_sec: (i + 1) * 10, distance_m: 0, spm: 28, power_w: watt, cal_per_hr: 0,
  level: 0, dps: 9.5, stroke_cycle_sec: 0, pace_sec_per_500m: pace, energy_joules: 0,
})
// 12 buckets: start bucket at 165, body at 108, overrun bucket at 122.
const samples: SessionSamples = {
  samples: [165, ...Array(10).fill(108), 122].map((p, i) => sample(i, p, i === 0 ? 250 : 380)),
  window: { from: 1, to: 11 },
}
const finding = (code: Finding['code'], category: Finding['category'], evidence: Record<string, number>): Finding => ({
  detector_id: 'x', code, severity: 'INFO', category, message_de: 'Satz.', evidence,
})

describe('findingWindow', () => {
  it('prefers the finding evidence, then the samples window, then the full series', () => {
    expect(findingWindow(finding('FADE', 'EFFICIENCY', { window_from: 2, window_to: 9 }), samples)).toEqual({ from: 2, to: 9 })
    expect(findingWindow(finding('FADE', 'EFFICIENCY', {}), samples)).toEqual({ from: 1, to: 11 })
    expect(findingWindow(finding('FADE', 'EFFICIENCY', {}), { ...samples, window: null })).toEqual({ from: 0, to: 12 })
    expect(findingWindow(finding('FADE', 'EFFICIENCY', { window_from: 5, window_to: 99 }), samples)).toEqual({ from: 0, to: 12 })
  })
})

describe('findingVisual', () => {
  it('pacing: h1 / h2 headline, halves shaded and levelled, cut to the window', () => {
    const v = findingVisual(finding('EVEN_SPLIT', 'PACING', { h1: 108.3, h2: 107.8 }), samples)
    expect(v.headline).toBe('1:48,3 / 1:47,8')
    expect(v.tag).toBe('gleichmäßig')
    expect(v.spark!.series).toHaveLength(10)
    expect(v.spark!.series).not.toContain(165)
    expect(v.spark!.shade).toEqual({ from: 5, to: 10 })
    expect(v.spark!.levels).toEqual([{ y: 108.3, from: 0, to: 5 }, { y: 107.8, from: 5, to: 10 }])
  })

  it('positive split reads as h1 → h2', () => {
    expect(findingVisual(finding('POSITIVE_SPLIT', 'PACING', { h1: 119.6, h2: 123.2 })).headline).toBe('1:59,6 → 2:03,2')
  })

  it('consistency: CV headline with a mean ± std band', () => {
    const v = findingVisual(finding('CONSISTENT_MID', 'CONSISTENCY', { cv: 2.04, mean: 108, std: 2.2 }), samples)
    expect(v.headline).toBe('Variation 2,0%')
    expect(v.tag).toBe('gleichmäßig')
    expect(v.spark!.band).toEqual({ lo: 105.8, hi: 110.2 })
  })

  it('fade: drop headline, watt series with the final 20 % shaded', () => {
    const v = findingVisual(finding('FADE', 'EFFICIENCY', { pct: 6.8, avg: 200, final: 186.4 }), samples)
    expect(v.headline).toBe('−6,8%')
    expect(v.tag).toBe('200 → 186 W')
    expect(v.spark!.series.every((w) => w === 380)).toBe(true)
    expect(v.spark!.shade).toEqual({ from: 8, to: 10 })
  })

  it('without samples there is a headline but no sparkline', () => {
    const v = findingVisual(finding('INCONSISTENT', 'CONSISTENCY', { cv: 6 }))
    expect(v.headline).toBe('Variation 6,0%')
    expect(v.spark).toBeNull()
  })

  it('missing evidence renders a dash, not NaN', () => {
    const v = findingVisual(finding('EVEN_SPLIT', 'PACING', {}))
    expect(v.headline).toBe('— / —')
  })
})
