import { describe, it, expect } from 'vitest'
import { PERSIST_MAX_AGE_MS, QUERY_GC_TIME } from './persister'

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
