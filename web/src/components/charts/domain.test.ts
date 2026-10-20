import { describe, it, expect } from 'vitest'
import { clampY, trimmedRange, workingYRange } from './domain'
import { selectYTicksRound } from './ticks'

const pts = (ys: number[]) => ys.map((y, i) => ({ x: i * 10, y }))

// 1:48 body with a 2:45 start bucket and a 2:02 overrun bucket.
const body = Array.from({ length: 100 }, (_, i) => 105 + (i * 3) % 7)
const startSpike = [165, ...body, 122]

describe('trimmedRange', () => {
  it('a start outlier does not set the domain', () => {
    const r = trimmedRange(startSpike)!
    expect(r.max).toBeLessThan(115)
    expect(r.min).toBeGreaterThanOrEqual(105)
  })

  it('keeps both levels of a genuine 20 s pace step mid-piece', () => {
    const step = [...Array(50).fill(108), ...Array(50).fill(128)]
    const r = trimmedRange(step)!
    expect(r.min).toBe(108)
    expect(r.max).toBe(128)
  })

  it('keeps a final sprint that is a few percent of the points', () => {
    const withSprint = [...Array(92).fill(108), ...Array(8).fill(102)]
    expect(trimmedRange(withSprint)!.min).toBe(102)
  })

  it('a flat series still yields a non-zero tick span', () => {
    const r = trimmedRange(Array(40).fill(108))!
    expect(r).toEqual({ min: 108, max: 108 })
    const ticks = selectYTicksRound(r.min, r.max, 'split')
    expect(ticks[ticks.length - 1]).toBeGreaterThan(ticks[0])
  })

  it('empty input has no range', () => {
    expect(trimmedRange([])).toBeNull()
  })
})

describe('workingYRange', () => {
  it('uses the points inside the window', () => {
    const p = pts(startSpike)
    const r = workingYRange(p, { fromX: p[1].x, toX: p[p.length - 2].x })!
    expect(r).toEqual({ min: Math.min(...body), max: Math.max(...body) })
  })

  it('falls back to the trimmed range without a window', () => {
    expect(workingYRange(pts(startSpike))).toEqual(trimmedRange(startSpike))
  })

  it('falls back when the window holds no point', () => {
    expect(workingYRange(pts(startSpike), { fromX: 1e6, toX: 2e6 })).toEqual(trimmedRange(startSpike))
  })

  it('on the reconstructed 11.06.2026 shape the split axis spans ~1:40–1:56', () => {
    const p = pts(startSpike)
    const r = workingYRange(p, { fromX: p[1].x, toX: p[p.length - 2].x })!
    const ticks = selectYTicksRound(r.min, r.max, 'split')
    expect(ticks[0]).toBeGreaterThanOrEqual(100)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(120)
  })
})

describe('clampY', () => {
  it('pins values outside the domain to its edge', () => {
    expect(clampY(165, 100, 115)).toBe(115)
    expect(clampY(90, 100, 115)).toBe(100)
    expect(clampY(108, 100, 115)).toBe(108)
  })
})
