import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listSessions, getSession, getSamples, deleteSession } from './client'

const realFetch = global.fetch

function mockFetch(impl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  ;(global as unknown as { fetch: typeof fetch }).fetch = vi.fn(impl) as unknown as typeof fetch
}

beforeEach(() => {
  mockFetch(async () => new Response(JSON.stringify({}), { status: 200 }))
})

afterEach(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = realFetch
})

describe('api client', () => {
  it('listSessions requests /api/v1/sessions and unwraps envelope', async () => {
    mockFetch(async (url) => {
      expect(String(url)).toBe('/api/v1/sessions?limit=50&offset=0&rower_id=R')
      return new Response(JSON.stringify({ sessions: [{ id: 'S1', rower_id: 'R', started_at: '2026-04-21T10:00:00Z', initial_level: 3 }] }), { status: 200 })
    })
    const out = await listSessions('R')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('S1')
  })

  it('getSession fetches and returns the row', async () => {
    mockFetch(async (url) => {
      expect(String(url)).toBe('/api/v1/sessions/S1')
      return new Response(JSON.stringify({ id: 'S1', rower_id: 'R', started_at: '2026-04-21T10:00:00Z', initial_level: 3 }), { status: 200 })
    })
    const out = await getSession('S1')
    expect(out.id).toBe('S1')
  })

  it('getSession throws on 404', async () => {
    mockFetch(async () => new Response('', { status: 404, statusText: 'Not Found' }))
    await expect(getSession('nope')).rejects.toThrow(/404/)
  })

  it('getSamples unwraps samples envelope', async () => {
    mockFetch(async (url) => {
      expect(String(url)).toBe('/api/v1/sessions/S1/samples')
      return new Response(JSON.stringify({ samples: [{ stroke_no: 1 }] }), { status: 200 })
    })
    const out = await getSamples('S1')
    expect(out.samples[0].stroke_no).toBe(1)
    expect(out.window).toBeNull()
  })

  it('getSamples carries the analysis window when present', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ samples: [{ stroke_no: 1 }], window: { from: 1, to: 104 } }), { status: 200 }))
    const out = await getSamples('S1')
    expect(out.window).toEqual({ from: 1, to: 104 })
  })

  it('deleteSession resolves on 204', async () => {
    mockFetch(async () => new Response(null, { status: 204 }))
    await expect(deleteSession('S1')).resolves.toBeUndefined()
  })
})
