import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k: string) => store.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
  del: vi.fn(async (k: string) => void store.delete(k)),
}))

import { loadCursor, saveCursor, type OfflineCursor } from './cursor'

const valid: OfflineCursor = {
  rowerId: 'R1',
  statsVersion: 7,
  schemaVersion: 1,
  packedAt: '2026-06-12T16:42:00.000Z',
  sessionIds: ['S1', 'S2'],
}

describe('offline cursor', () => {
  beforeEach(() => store.clear())

  it('round-trips a valid cursor', async () => {
    await saveCursor(valid)
    expect(await loadCursor()).toEqual(valid)
  })

  it('returns null when nothing is stored', async () => {
    expect(await loadCursor()).toBeNull()
  })

  it('returns null for malformed payloads instead of throwing', async () => {
    store.set('splits:offline-cursor', { rowerId: 'R1' })
    expect(await loadCursor()).toBeNull()
    store.set('splits:offline-cursor', 'garbage')
    expect(await loadCursor()).toBeNull()
  })
})
