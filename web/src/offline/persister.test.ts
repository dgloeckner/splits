import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  persistQueryClientRestore,
  persistQueryClientSave,
  type PersistedClient,
} from '@tanstack/react-query-persist-client'
import {
  PERSIST_BUSTER,
  PERSIST_MAX_AGE_MS,
  PERSIST_SCHEMA_VERSION,
  QUERY_GC_TIME,
} from './persister'

// Browsers fire a setTimeout whose delay exceeds 2^31-1 ms immediately,
// and react-query passes gcTime to setTimeout unclamped. A 30-day gcTime
// therefore garbage-collected every unobserved query (the whole offline
// pack) right after its fetch, before the persister could write it.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

describe('QUERY_GC_TIME', () => {
  it('is a delay the browser timer honours (or Infinity = never)', () => {
    expect(QUERY_GC_TIME === Infinity || QUERY_GC_TIME <= MAX_TIMER_DELAY_MS).toBe(true)
  })

  it('keeps queries at least as long as the persisted bag lives', () => {
    expect(QUERY_GC_TIME).toBeGreaterThanOrEqual(PERSIST_MAX_AGE_MS)
  })
})

describe('persisted bag survives a deploy (issue #6, ADR-0021)', () => {
  // In-memory persister: the round-trip, not IndexedDB, is under test.
  function memoryPersister() {
    let stored: PersistedClient | undefined
    return {
      persistClient: async (c: PersistedClient) => void (stored = c),
      restoreClient: async () => stored,
      removeClient: async () => void (stored = undefined),
      get stored() {
        return stored
      },
    }
  }

  async function writeBag(buster: string) {
    const persister = memoryPersister()
    const qc = new QueryClient()
    qc.setQueryData(['rowers'], [{ id: 'r1' }])
    await persistQueryClientSave({ queryClient: qc, persister, buster })
    return persister
  }

  it('the buster is the schema version, not the build', () => {
    expect(PERSIST_BUSTER).toBe(String(PERSIST_SCHEMA_VERSION))
  })

  it('restores a bag written under the same schema version (any build)', async () => {
    const persister = await writeBag(PERSIST_BUSTER)
    const qc = new QueryClient()
    await persistQueryClientRestore({ queryClient: qc, persister, buster: PERSIST_BUSTER })
    expect(qc.getQueryData(['rowers'])).toEqual([{ id: 'r1' }])
  })

  it('discards a bag written under another schema version', async () => {
    const persister = await writeBag(String(PERSIST_SCHEMA_VERSION + 1))
    const qc = new QueryClient()
    await persistQueryClientRestore({ queryClient: qc, persister, buster: PERSIST_BUSTER })
    expect(qc.getQueryData(['rowers'])).toBeUndefined()
    expect(persister.stored).toBeUndefined()
  })
})
