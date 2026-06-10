import { fmtMmSs, fmtMmSsTenths } from './formatDuration'

describe('fmtMmSs', () => {
  it('carries rounded seconds into the minute', () => {
    expect(fmtMmSs(119.6)).toBe('2:00')
    expect(fmtMmSs(119.4)).toBe('1:59')
    expect(fmtMmSs(-119.6)).toBe('-2:00')
    expect(fmtMmSs(0)).toBe('0:00')
  })
})
describe('fmtMmSsTenths', () => {
  it('carries rounded tenths into the minute', () => {
    expect(fmtMmSsTenths(119.96)).toBe('2:00.0')
    expect(fmtMmSsTenths(119.94)).toBe('1:59.9')
    expect(fmtMmSsTenths(125.0)).toBe('2:05.0')
  })
})
