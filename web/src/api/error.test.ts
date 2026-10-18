import { describe, it, expect, vi, afterEach } from 'vitest'
import { getFetch, GET_TIMEOUT_MS, NetworkError } from './error'
import { SW_NETWORK_TIMEOUT_SECONDS } from '../offline/swRoutes'

afterEach(() => vi.unstubAllGlobals())

describe('getFetch', () => {
  // Epic #1 / B1: if the page aborts first, the SW NetworkFirst never
  // gets to serve its cache on a hanging connection. Keep a margin.
  it('outlasts the SW network timeout by at least 3 s', () => {
    expect(GET_TIMEOUT_MS).toBeGreaterThanOrEqual(SW_NETWORK_TIMEOUT_SECONDS * 1000 + 3000)
  })

  it('aborts a hanging fetch after the timeout', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        }),
    )
    await expect(getFetch('/api/v1/rowers', 20)).rejects.toBeInstanceOf(NetworkError)
  })

  it('passes a successful response through', async () => {
    const resp = new Response('{}', { status: 200 })
    vi.stubGlobal('fetch', async () => resp)
    expect(await getFetch('/api/v1/rowers')).toBe(resp)
  })
})
