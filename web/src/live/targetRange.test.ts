import { describe, it, expect } from 'vitest'
import { inRange } from './targetRange'

describe('inRange', () => {
  it('returns none when value is null', () => {
    expect(inRange(null, { lo: 10, hi: 20 })).toBe('none')
  })
  it('returns none when value is undefined', () => {
    expect(inRange(undefined, { lo: 10, hi: 20 })).toBe('none')
  })
  it('returns none when value is 0', () => {
    expect(inRange(0, { lo: 10, hi: 20 })).toBe('none')
  })
  it('returns none when range is undefined', () => {
    expect(inRange(15, undefined)).toBe('none')
  })
  it('returns in when inside', () => {
    expect(inRange(15, { lo: 10, hi: 20 })).toBe('in')
  })
  it('returns in at exact lo bound', () => {
    expect(inRange(10, { lo: 10, hi: 20 })).toBe('in')
  })
  it('returns in at exact hi bound', () => {
    expect(inRange(20, { lo: 10, hi: 20 })).toBe('in')
  })
  it('returns under when below lo', () => {
    expect(inRange(5, { lo: 10, hi: 20 })).toBe('under')
  })
  it('returns over when above hi', () => {
    expect(inRange(25, { lo: 10, hi: 20 })).toBe('over')
  })
  it('unbounded hi: any value above lo is in', () => {
    expect(inRange(9999, { lo: 30, hi: null })).toBe('in')
  })
  it('unbounded hi: below lo is under', () => {
    expect(inRange(20, { lo: 30, hi: null })).toBe('under')
  })
})
