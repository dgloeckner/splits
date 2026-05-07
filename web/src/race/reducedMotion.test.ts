import { renderHook } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useReducedMotion } from './reducedMotion'

describe('useReducedMotion', () => {
  it('returns false by default in jsdom', () => {
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })

  it('returns true when matchMedia reports reduced motion', () => {
    const original = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({
        matches: q.includes('reduce'),
        media: q, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true },
        onchange: null,
      }),
    })
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original })
  })
})
