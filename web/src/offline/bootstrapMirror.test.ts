import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadBootstrapMirror,
  recordBootstrapQuery,
  _resetBootstrapMirrorForTest,
} from './bootstrapMirror'

const KEY = 'splits:bootstrap'
const r1 = { id: 'r1', name: 'Daniel', color: '#5dd7e4', created_at: '2026-05-03T19:01:59Z' }
const r2 = { id: 'r2', name: 'Anna', color: '#f59e0b', created_at: '2026-05-04T19:01:59Z' }

describe('bootstrap mirror (ADR-0021)', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetBootstrapMirrorForTest()
  })

  it('is empty until both bootstrap queries have succeeded with a rower', () => {
    expect(loadBootstrapMirror()).toBeNull()
    recordBootstrapQuery(['rowers'], [r1, r2])
    expect(loadBootstrapMirror()).toBeNull()
    recordBootstrapQuery(['active-rower'], r1)
    const m = loadBootstrapMirror()
    expect(m?.rowers).toEqual([r1, r2])
    expect(m?.active).toEqual(r1)
    expect(Date.parse(m!.savedAt)).not.toBeNaN()
  })

  it('updates on later successes', () => {
    recordBootstrapQuery(['rowers'], [r1, r2])
    recordBootstrapQuery(['active-rower'], r1)
    recordBootstrapQuery(['active-rower'], r2)
    expect(loadBootstrapMirror()?.active).toEqual(r2)
  })

  it('is cleared — never written empty — when a fresh fetch finds no rower', () => {
    recordBootstrapQuery(['rowers'], [r1])
    recordBootstrapQuery(['active-rower'], r1)
    recordBootstrapQuery(['rowers'], [])
    expect(loadBootstrapMirror()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()

    recordBootstrapQuery(['rowers'], [r1])
    expect(loadBootstrapMirror()).toBeNull() // active must be confirmed again
    recordBootstrapQuery(['active-rower'], r1)
    recordBootstrapQuery(['active-rower'], null)
    expect(loadBootstrapMirror()).toBeNull()
  })

  it('survives a module reload (reads localStorage)', () => {
    recordBootstrapQuery(['rowers'], [r1])
    recordBootstrapQuery(['active-rower'], r1)
    _resetBootstrapMirrorForTest()
    expect(loadBootstrapMirror()?.active).toEqual(r1)
    // A partial update after reload keeps the stored other half.
    recordBootstrapQuery(['rowers'], [r1, r2])
    expect(loadBootstrapMirror()?.rowers).toEqual([r1, r2])
  })

  it('ignores unrelated query keys', () => {
    recordBootstrapQuery(['rowers', 'r1'], [r1])
    recordBootstrapQuery(['sessions'], [])
    expect(loadBootstrapMirror()).toBeNull()
  })

  it.each([
    ['not JSON', '{nope'],
    ['wrong shape', JSON.stringify({ rowers: 'x', active: r1, savedAt: 'now' })],
    ['empty rowers', JSON.stringify({ rowers: [], active: r1, savedAt: '2026-01-01T00:00:00Z' })],
    ['no active', JSON.stringify({ rowers: [r1], active: null, savedAt: '2026-01-01T00:00:00Z' })],
    ['rower without id', JSON.stringify({ rowers: [{}], active: r1, savedAt: '2026-01-01T00:00:00Z' })],
    ['bad savedAt', JSON.stringify({ rowers: [r1], active: r1, savedAt: 'later' })],
  ])('rejects a corrupt mirror (%s)', (_name, raw) => {
    localStorage.setItem(KEY, raw)
    expect(loadBootstrapMirror()).toBeNull()
  })

  it('tolerates localStorage throwing', () => {
    const orig = Storage.prototype.getItem
    Storage.prototype.getItem = () => {
      throw new Error('denied')
    }
    try {
      expect(loadBootstrapMirror()).toBeNull()
    } finally {
      Storage.prototype.getItem = orig
    }
  })
})
