import { describe, it, expect } from 'vitest'
import { formatStripDelta } from './stripDelta'

describe('formatStripDelta', () => {
  it('split: −1,3 s vs Ø 14 T (sign follows the raw delta, German comma)', () => {
    expect(formatStripDelta(110.2, 111.5, 14, 'split')).toBe('−1,3 s vs Ø 14 T')
  })
  it('watt', () => expect(formatStripDelta(212, 200, 30, 'watt')).toBe('+12 W vs Ø 30 T'))
  it('spm', () => expect(formatStripDelta(20.4, 19.9, 14, 'spm')).toBe('+0,5 SPM vs Ø 14 T'))
  it('dps', () => expect(formatStripDelta(9.4, 9.0, 90, 'dps')).toBe('+0,4 m vs Ø 90 T'))
  it('no average → dash', () => expect(formatStripDelta(110, null, 14, 'split')).toBe('—'))
})
