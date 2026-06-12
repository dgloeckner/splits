import { describe, it, expect, vi, afterEach } from 'vitest'
import { getFetch, GET_TIMEOUT_MS, NetworkError } from './error'

afterEach(() => vi.unstubAllGlobals())

describe('getFetch', () => {
  it('exports a 6 s default timeout', () => {
    expect(GET_TIMEOUT_MS).toBe(6000)
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
