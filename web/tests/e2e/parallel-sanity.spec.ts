import { test, expect } from './fixtures'
import { pickFreePort } from './helpers/ports'

/**
 * Parallel-sanity check for 0016-01.
 *
 * Each test spawns its own backend on a freshly picked port and hits
 * `/api/health` directly. With `--workers=2` (or higher) both tests
 * run concurrently in separate worker processes; if port allocation
 * is broken they collide and one fails.
 *
 * Deliberately bypasses the page / baseURL path: that machinery
 * involves Vite + the React frontend and belongs to slice 0016-05
 * (canonical happy path). The infra goal here is "two backends, two
 * ports, no collision".
 */
test.describe('parallel-sanity (0016-01)', () => {
  test('backend A binds a free port and serves /api/health', async ({ startBackend }) => {
    const port = await pickFreePort()
    const handle = await startBackend({ addr: `127.0.0.1:${port}` })
    expect(handle.addr).toBe(`127.0.0.1:${port}`)
    const r = await fetch(`http://${handle.addr}/api/health`)
    expect(r.status).toBe(200)
  })

  test('backend B binds a free port and serves /api/health', async ({ startBackend }) => {
    const port = await pickFreePort()
    const handle = await startBackend({ addr: `127.0.0.1:${port}` })
    expect(handle.addr).toBe(`127.0.0.1:${port}`)
    const r = await fetch(`http://${handle.addr}/api/health`)
    expect(r.status).toBe(200)
  })
})
