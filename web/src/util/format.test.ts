import { describe, it, expect } from 'vitest'
import { mmss, mmssWhole, pace500m, fmtInt, fmtFloat, fmtMeters } from './format'

describe('mmss', () => {
  it.each([
    [0, '0:00.0'],
    [5.3, '0:05.3'],
    [65.4, '1:05.4'],
    [600, '10:00.0'],
    [3599.9, '59:59.9'],
  ])('formats %s seconds as %s', (input, expected) => {
    expect(mmss(input)).toBe(expected)
  })

  it('returns an em-dash for null / undefined / NaN', () => {
    expect(mmss(null)).toBe('—')
    expect(mmss(undefined)).toBe('—')
    expect(mmss(NaN)).toBe('—')
  })
})

describe('mmssWhole', () => {
  it('formats whole seconds as m:ss without decimals', () => {
    expect(mmssWhole(0)).toBe('0:00')
    expect(mmssWhole(65)).toBe('1:05')
    expect(mmssWhole(65.9)).toBe('1:05')
    expect(mmssWhole(3599)).toBe('59:59')
  })

  it('returns em-dash for null', () => {
    expect(mmssWhole(null)).toBe('—')
  })
})

describe('pace500m', () => {
  it('formats a pace-seconds-per-500m integer as m:ss.0', () => {
    expect(pace500m(132)).toBe('2:12.0')
    expect(pace500m(115)).toBe('1:55.0')
  })

  it('returns an em-dash when null or <= 0', () => {
    expect(pace500m(null)).toBe('—')
    expect(pace500m(0)).toBe('—')
    expect(pace500m(-5)).toBe('—')
  })
})

describe('fmtInt', () => {
  it('formats integers with no decimals', () => {
    expect(fmtInt(245)).toBe('245')
    expect(fmtInt(0)).toBe('0')
  })

  it('returns em-dash for null', () => {
    expect(fmtInt(null)).toBe('—')
  })
})

describe('fmtFloat', () => {
  it('formats with given decimal places', () => {
    expect(fmtFloat(8.43, 1)).toBe('8.4')
    expect(fmtFloat(8.45, 1)).toBe('8.5')
    expect(fmtFloat(8, 2)).toBe('8.00')
  })

  it('returns em-dash for null', () => {
    expect(fmtFloat(null, 1)).toBe('—')
  })
})

describe('fmtMeters', () => {
  it('formats distances as plain integers with no thousands separator', () => {
    expect(fmtMeters(342)).toBe('342')
    expect(fmtMeters(1234)).toBe('1234')
    expect(fmtMeters(0)).toBe('0')
  })
})
