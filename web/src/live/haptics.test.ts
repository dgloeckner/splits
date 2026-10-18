import { describe, it, expect, vi, afterEach } from 'vitest'
import { vibrate } from './haptics'

// `vibrate` is optional in practice (Safari, desktop) even though lib.dom
// declares it, so the tests view it as optional to be able to remove it.
const nav = navigator as { vibrate?: Navigator['vibrate'] }

describe('vibrate', () => {
  const original = nav.vibrate
  afterEach(() => { nav.vibrate = original })

  it('returns false when vibrate API is missing', () => {
    nav.vibrate = undefined
    expect(vibrate(50)).toBe(false)
  })

  it('calls navigator.vibrate with the pattern', () => {
    const spy = vi.fn(() => true)
    nav.vibrate = spy
    expect(vibrate([80, 40, 80])).toBe(true)
    expect(spy).toHaveBeenCalledWith([80, 40, 80])
  })
})
