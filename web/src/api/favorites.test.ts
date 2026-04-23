import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listFavorites, createFavorite, deleteFavorite } from './favorites'

const originalFetch = global.fetch
function mockFetch(impl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  ;(global as unknown as { fetch: typeof fetch }).fetch = vi.fn(impl) as unknown as typeof fetch
}
beforeEach(() => mockFetch(async () => new Response('{}', { status: 200 })))
afterEach(() => { ;(global as unknown as { fetch: typeof fetch }).fetch = originalFetch })

describe('favorites api', () => {
  it('listFavorites unwraps envelope', async () => {
    mockFetch(async (url) => {
      expect(String(url)).toBe('/api/v1/favorites?rower_id=R1')
      return new Response(JSON.stringify({ favorites: [{ id: 'F1', rower_id: 'R1', name: 'A', mode: 'time', params: { seconds: 600 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-23T00:00:00Z' }] }), { status: 200 })
    })
    const out = await listFavorites('R1')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('A')
  })

  it('createFavorite posts full body', async () => {
    mockFetch(async (url, init) => {
      expect(String(url)).toBe('/api/v1/favorites')
      expect(JSON.parse(init?.body as string)).toMatchObject({ rower_id: 'R1', name: 'My 5k', mode: 'distance' })
      return new Response(JSON.stringify({ id: 'F2', rower_id: 'R1', name: 'My 5k', mode: 'distance', params: { meters: 5000 }, warmup_sec: 300, cooldown_sec: 0, created_at: '2026-04-23T00:00:00Z' }), { status: 201 })
    })
    const out = await createFavorite({ rower_id: 'R1', name: 'My 5k', mode: 'distance', params: { meters: 5000 }, warmup_sec: 300 })
    expect(out.id).toBe('F2')
  })

  it('deleteFavorite sends DELETE', async () => {
    mockFetch(async (url, init) => {
      expect(String(url)).toBe('/api/v1/favorites/F1')
      expect(init?.method).toBe('DELETE')
      return new Response(null, { status: 204 })
    })
    await deleteFavorite('F1')
  })
})
