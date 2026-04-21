import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listRowers, createRower, getActiveRower, setActiveRower } from './rowers'

const originalFetch = global.fetch

function mockFetch(status: number, body: unknown) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
}

beforeEach(() => {})
afterEach(() => {
  global.fetch = originalFetch
})

describe('rowers api', () => {
  it('listRowers unwraps {rowers: []}', async () => {
    mockFetch(200, { rowers: [{ id: 'a', name: 'Alice', color: '#fff', created_at: '2026-04-21T00:00:00Z' }] })
    const list = await listRowers()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Alice')
  })

  it('createRower posts and returns row', async () => {
    mockFetch(201, { id: 'a', name: 'Alice', color: '#fff', created_at: '2026-04-21T00:00:00Z' })
    const r = await createRower({ name: 'Alice' })
    expect(r.id).toBe('a')
  })

  it('getActiveRower returns null on 404', async () => {
    mockFetch(404, {})
    const r = await getActiveRower()
    expect(r).toBeNull()
  })

  it('setActiveRower puts rower_id', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ id: 'a', name: 'Alice', color: '#fff', created_at: '2026-04-21T00:00:00Z' }), { status: 200 }))
    global.fetch = spy as unknown as typeof fetch
    await setActiveRower('a')
    expect(spy).toHaveBeenCalledWith('/api/v1/active-rower', expect.objectContaining({ method: 'PUT' }))
  })
})
