import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mintPairing, pair } from './pairing'
import { ApiError } from './error'

const realFetch = global.fetch

function mockFetch(impl: (url: RequestInfo, init?: RequestInit) => Promise<Response>) {
  ;(global as unknown as { fetch: typeof fetch }).fetch = impl as unknown as typeof fetch
}

beforeEach(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = realFetch
})
afterEach(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = realFetch
})

describe('pairing api client', () => {
  it('mintPairing returns token+url+qr', async () => {
    mockFetch(async (url, init) => {
      expect(String(url)).toBe('/api/v1/rowers/R1/pairing-tokens')
      expect(init?.method).toBe('POST')
      return new Response(
        JSON.stringify({
          token: 'abc',
          url: 'https://h/pair#t=abc',
          qr_svg: '<svg/>',
          expires_at: '2026-04-29T00:00:00Z',
        }),
        { status: 200 },
      )
    })
    const out = await mintPairing('R1')
    expect(out.token).toBe('abc')
    expect(out.url).toContain('/pair#t=abc')
    expect(out.qr_svg).toContain('<svg')
  })

  it('pair posts the token and resolves on 200', async () => {
    mockFetch(async (url, init) => {
      expect(String(url)).toBe('/api/v1/pair')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ token: 'abc' })
      return new Response('', { status: 200 })
    })
    await expect(pair('abc')).resolves.toBeUndefined()
  })

  it('pair throws ApiError(410) on stale token', async () => {
    mockFetch(async () => new Response('gone', { status: 410 }))
    let caught: unknown
    try {
      await pair('stale')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(410)
  })
})
