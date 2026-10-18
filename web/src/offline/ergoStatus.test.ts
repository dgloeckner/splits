import { describe, it, expect, beforeEach } from 'vitest'
import {
  getErgoStatus,
  setErgoStatus,
  subscribeErgoStatus,
  _resetErgoStatusForTest,
} from './ergoStatus'

describe('ergoStatus store', () => {
  beforeEach(() => _resetErgoStatusForTest())

  // ADR-0021: nothing is known until the first /api/health probe lands.
  it("starts 'unknown' with no Stand", () => {
    expect(getErgoStatus()).toEqual({ reachable: 'unknown', packedAt: null, packedSessions: 0 })
  })

  it('patches and notifies subscribers once per change', () => {
    let calls = 0
    subscribeErgoStatus(() => calls++)
    setErgoStatus({ reachable: false })
    setErgoStatus({ reachable: false }) // no-op patch — no notify
    expect(calls).toBe(1)
    expect(getErgoStatus().reachable).toBe(false)
  })

  // Reachability is no longer inferred from query success — under the
  // NetworkFirst SW cache a read can succeed from cache while the ergo
  // is unreachable. It is owned by the /api/health probe instead; see
  // reachability.test.ts. The store just holds whatever the probe sets.
})
