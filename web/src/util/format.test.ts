import { describe, it, expect } from 'vitest'
import { mmss, mmssWhole, pace500m, fmtInt, fmtFloat, fmtMeters, hhmm, signedPct, signedNum, formatDurationHuman } from './format'

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

describe('hhmm', () => {
  it('formats seconds as h:mm', () => {
    expect(hhmm(0)).toBe('0:00')
    expect(hhmm(60)).toBe('0:01')
    expect(hhmm(5_400)).toBe('1:30')
    expect(hhmm(36_000)).toBe('10:00')
  })

  it('returns em-dash for null / NaN', () => {
    expect(hhmm(null)).toBe('—')
    expect(hhmm(NaN)).toBe('—')
  })
})

describe('signedPct', () => {
  it('formats fractions with leading sign', () => {
    expect(signedPct(0.123)).toBe('+12 %')
    expect(signedPct(-0.05)).toBe('-5 %')
    expect(signedPct(0)).toBe('0 %')
  })

  it('returns em-dash for null / NaN', () => {
    expect(signedPct(null)).toBe('—')
    expect(signedPct(NaN)).toBe('—')
  })
})

describe('signedNum', () => {
  it('formats with leading sign and given decimals', () => {
    expect(signedNum(0.42, 1)).toBe('+0.4')
    expect(signedNum(-1.27, 1)).toBe('-1.3')
    expect(signedNum(0, 1)).toBe('0.0')
  })

  it('returns em-dash for null', () => {
    expect(signedNum(null)).toBe('—')
  })
})

describe('formatDurationHuman', () => {
  it('1 h 30 min', () => expect(formatDurationHuman(5400)).toBe('1 h 30 min'))
  it('2 min', () => expect(formatDurationHuman(120)).toBe('2 min'))
  it('exact hours omit minutes', () => expect(formatDurationHuman(7200)).toBe('2 h'))
  it('carry-safe at the hour boundary', () => expect(formatDurationHuman(3599)).toBe('1 h'))
  it('sub-minute rounds to minutes', () => expect(formatDurationHuman(40)).toBe('1 min'))
  it('zero', () => expect(formatDurationHuman(0)).toBe('0 min'))
})
