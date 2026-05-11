import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureEndSessionQueue,
  enqueueEndSession,
  processPendingEndSessions,
  peekPendingEndSessions,
  STORAGE_KEY,
  _resetEndSessionQueueForTests,
} from './endSessionQueue'

beforeEach(() => {
  _resetEndSessionQueueForTests()
  localStorage.clear()
})
afterEach(() => {
  _resetEndSessionQueueForTests()
})

describe('endSessionQueue', () => {
  it('enqueues to localStorage keyed by session_id', () => {
    enqueueEndSession('sess-1')
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toEqual(['sess-1'])
    expect(peekPendingEndSessions()).toEqual(['sess-1'])
  })

  it('collapses duplicate enqueues to one', () => {
    enqueueEndSession('sess-1')
    enqueueEndSession('sess-1')
    enqueueEndSession('sess-1')
    expect(peekPendingEndSessions()).toEqual(['sess-1'])
  })

  it('processPending drains the queue on success and invalidates sessions', async () => {
    const endSession = vi.fn().mockResolvedValue(undefined)
    const onSuccess = vi.fn()
    const onPersistentFailure = vi.fn()
    configureEndSessionQueue({ endSession, onSuccess, onPersistentFailure })
    enqueueEndSession('sess-1')
    enqueueEndSession('sess-2')
    await processPendingEndSessions()
    expect(endSession).toHaveBeenCalledTimes(2)
    expect(peekPendingEndSessions()).toEqual([])
    expect(onSuccess).toHaveBeenCalled()
    expect(onPersistentFailure).not.toHaveBeenCalled()
  })

  it('leaves entry in queue on failure and shows toast', async () => {
    const endSession = vi.fn().mockRejectedValue(new Error('network'))
    const onSuccess = vi.fn()
    const onPersistentFailure = vi.fn()
    configureEndSessionQueue({ endSession, onSuccess, onPersistentFailure })
    enqueueEndSession('sess-1')
    await processPendingEndSessions()
    expect(peekPendingEndSessions()).toEqual(['sess-1'])
    expect(onPersistentFailure).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('processPending picks up entries persisted from a prior run', async () => {
    // Simulate prior run that left a pending entry
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['sess-prev']))
    const endSession = vi.fn().mockResolvedValue(undefined)
    configureEndSessionQueue({
      endSession,
      onSuccess: () => {},
      onPersistentFailure: () => {},
    })
    await processPendingEndSessions()
    expect(endSession).toHaveBeenCalledWith('sess-prev')
    expect(peekPendingEndSessions()).toEqual([])
  })

  it('partial failure: drains success, leaves failures, raises toast once', async () => {
    const endSession = vi.fn(async (id: string) => {
      if (id === 'bad') throw new Error('boom')
    })
    const onSuccess = vi.fn()
    const onPersistentFailure = vi.fn()
    configureEndSessionQueue({ endSession, onSuccess, onPersistentFailure })
    enqueueEndSession('ok-1')
    enqueueEndSession('bad')
    enqueueEndSession('ok-2')
    await processPendingEndSessions()
    expect(peekPendingEndSessions()).toEqual(['bad'])
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onPersistentFailure).toHaveBeenCalledTimes(1)
  })

  it('concurrent processPending calls are serialised', async () => {
    let resolve!: () => void
    const blocked = new Promise<void>((r) => {
      resolve = r
    })
    const endSession = vi.fn(async () => {
      await blocked
    })
    configureEndSessionQueue({
      endSession,
      onSuccess: () => {},
      onPersistentFailure: () => {},
    })
    enqueueEndSession('sess-1')
    const a = processPendingEndSessions()
    const b = processPendingEndSessions()
    resolve()
    await Promise.all([a, b])
    expect(endSession).toHaveBeenCalledTimes(1)
  })
})
