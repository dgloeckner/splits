import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useWakeLock } from './useWakeLock'

type FakeSentinel = {
  released: boolean
  release: () => Promise<void>
}

function installWakeLock() {
  const requested: FakeSentinel[] = []
  const request = vi.fn(async (kind: string) => {
    expect(kind).toBe('screen')
    const s: FakeSentinel = {
      released: false,
      release: vi.fn(async () => {
        s.released = true
      }),
    }
    requested.push(s)
    return s
  })
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request },
  })
  return { request, requested }
}

function uninstallWakeLock() {
  // delete via redefining undefined; configurable above lets us remove.
  // jsdom doesn't natively expose wakeLock so undefined is fine.
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: undefined,
  })
}

let visibilityState: DocumentVisibilityState = 'visible'

beforeEach(() => {
  visibilityState = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState,
  })
})

afterEach(() => {
  uninstallWakeLock()
  vi.restoreAllMocks()
})

describe('useWakeLock', () => {
  it('requests screen wake lock when active=true', async () => {
    const { request } = installWakeLock()
    await act(async () => {
      renderHook(() => useWakeLock(true))
    })
    expect(request).toHaveBeenCalledWith('screen')
  })

  it('does not request when active=false', async () => {
    const { request } = installWakeLock()
    await act(async () => {
      renderHook(() => useWakeLock(false))
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('re-requests on visibilitychange when returning to visible', async () => {
    const { request } = installWakeLock()
    await act(async () => {
      renderHook(() => useWakeLock(true))
    })
    expect(request).toHaveBeenCalledTimes(1)

    // Simulate hidden then visible.
    visibilityState = 'hidden'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    visibilityState = 'visible'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('logs but does not throw when request fails', async () => {
    const errSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    await act(async () => {
      renderHook(() => useWakeLock(true))
    })
    // microtask drain
    await Promise.resolve()
    expect(errSpy).toHaveBeenCalled()
  })

  it('is non-blocking when wakeLock is unsupported', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: undefined,
    })
    expect(() => {
      renderHook(() => useWakeLock(true))
    }).not.toThrow()
  })
})
