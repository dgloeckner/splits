import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_LAYOUT, loadLayout, replaceSlot, saveLayout } from './layout'

describe('tile layout storage', () => {
  beforeEach(() => localStorage.clear())

  it('returns the default layout when localStorage is empty', () => {
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT)
  })

  it('round-trips a saved layout', () => {
    const next = [...DEFAULT_LAYOUT] as ReturnType<typeof loadLayout>
    next[0] = 'spm'
    saveLayout(next)
    expect(loadLayout()).toEqual(next)
  })

  it('falls back to default on corrupt storage', () => {
    localStorage.setItem('home-ergo:tile-layout:v1', 'not-json{')
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT)
  })

  it('replaceSlot returns a new array with the slot swapped', () => {
    const updated = replaceSlot(DEFAULT_LAYOUT, 2, 'spm')
    expect(updated[2]).toBe('spm')
    expect(updated[0]).toBe(DEFAULT_LAYOUT[0])
    expect(updated).not.toBe(DEFAULT_LAYOUT)
  })
})
