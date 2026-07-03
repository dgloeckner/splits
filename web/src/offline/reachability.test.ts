import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { probeReachable, startReachabilityProbe, _resetReachabilityForTest, REPROBE_WHILE_DOWN_MS, retryReachabilityNow } from './reachability'
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

describe('self-healing loop', () => {
  beforeEach(() => {
    _resetReachabilityForTest()
    _resetErgoStatusForTest()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('re-probes on an interval while unreachable and recovers', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    startReachabilityProbe()
    await vi.advanceTimersByTimeAsync(1) // flush the boot probe (fails)
    expect(getErgoStatus().reachable).toBe(false)

    await vi.advanceTimersByTimeAsync(REPROBE_WHILE_DOWN_MS) // interval probe succeeds
    expect(getErgoStatus().reachable).toBe(true)

    // Once reachable, the down-interval must stop.
    const calls = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(REPROBE_WHILE_DOWN_MS * 3)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('fires onReconnect exactly once per false→true transition', async () => {
    vi.useFakeTimers()
    const onReconnect = vi.fn()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    startReachabilityProbe({ onReconnect })
    await vi.advanceTimersByTimeAsync(1) // boot probe fails: true→false, no hook
    expect(onReconnect).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(REPROBE_WHILE_DOWN_MS) // false→true
    expect(onReconnect).toHaveBeenCalledTimes(1)

    retryReachabilityNow() // already reachable: succeeds again, must NOT re-fire
    await vi.advanceTimersByTimeAsync(1)
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('retryReachabilityNow probes immediately without waiting for the interval', async () => {
    setErgoStatus({ reachable: false })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"status":"ok"}', { status: 200 })),
    )
    retryReachabilityNow()
    await vi.waitFor(() => expect(getErgoStatus().reachable).toBe(true))
  })
})
