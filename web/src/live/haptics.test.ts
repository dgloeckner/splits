import { describe, it, expect, vi, afterEach } from 'vitest'
import { vibrate } from './haptics'

describe('vibrate', () => {
  const original = (navigator as any).vibrate
  afterEach(() => { (navigator as any).vibrate = original })

  it('returns false when vibrate API is missing', () => {
    ;(navigator as any).vibrate = undefined
    expect(vibrate(50)).toBe(false)
  })

  it('calls navigator.vibrate with the pattern', () => {
    const spy = vi.fn(() => true)
    ;(navigator as any).vibrate = spy
    expect(vibrate([80, 40, 80])).toBe(true)
    expect(spy).toHaveBeenCalledWith([80, 40, 80])
  })
})
