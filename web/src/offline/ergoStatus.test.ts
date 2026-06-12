import { describe, it, expect, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  attachReachabilityListener,
  getErgoStatus,
  setErgoStatus,
  subscribeErgoStatus,
  _resetErgoStatusForTest,
} from './ergoStatus'

describe('ergoStatus store', () => {
  beforeEach(() => _resetErgoStatusForTest())

  it('starts reachable with no Stand', () => {
    expect(getErgoStatus()).toEqual({ reachable: true, packedAt: null, packedSessions: 0 })
  })

  it('patches and notifies subscribers once per change', () => {
    let calls = 0
    subscribeErgoStatus(() => calls++)
    setErgoStatus({ reachable: false })
    setErgoStatus({ reachable: false }) // no-op patch — no notify
    expect(calls).toBe(1)
    expect(getErgoStatus().reachable).toBe(false)
  })

  it('any successful query flips reachable back on', async () => {
    setErgoStatus({ reachable: false })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    attachReachabilityListener(qc)
    await qc.fetchQuery({ queryKey: ['probe'], queryFn: async () => 42 })
    expect(getErgoStatus().reachable).toBe(true)
  })
})
