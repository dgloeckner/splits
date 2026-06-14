import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { probeReachable, startReachabilityProbe, _resetReachabilityForTest } from './reachability'
import { getErgoStatus, setErgoStatus, _resetErgoStatusForTest } from './ergoStatus'

describe('reachability probe', () => {
  beforeEach(() => {
    _resetReachabilityForTest()
    _resetErgoStatusForTest()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('probeReachable is true on a 200 from /api/health', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(probeReachable()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }))
  })

  it('probeReachable is false on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')))
    await expect(probeReachable()).resolves.toBe(false)
  })

  it('probeReachable is false on a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    await expect(probeReachable()).resolves.toBe(false)
  })

  it('startReachabilityProbe flips reachable to false when the backend is gone', async () => {
    // Start optimistic (the store default), then a failing probe lands.
    setErgoStatus({ reachable: true })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')))
    startReachabilityProbe()
    await vi.waitFor(() => expect(getErgoStatus().reachable).toBe(false))
  })

  it('startReachabilityProbe sets reachable true when the backend answers', async () => {
    setErgoStatus({ reachable: false })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"status":"ok"}', { status: 200 })))
    startReachabilityProbe()
    await vi.waitFor(() => expect(getErgoStatus().reachable).toBe(true))
  })
})
