import { createServer } from 'node:net'

/**
 * Ask the kernel for a free TCP port by binding to :0 and reading
 * the assigned port back. Returns the port number and releases the
 * socket so callers can bind it themselves.
 *
 * There's an inherent race between releasing the socket and the
 * caller re-binding, but for our short-lived per-test ports it's
 * been reliable in practice. If we ever see flakes we can retry.
 */
export function pickFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, host, () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        srv.close()
        reject(new Error('pickFreePort: unexpected address shape'))
      }
    })
  })
}

/** Pick `n` distinct free ports. */
export async function pickFreePorts(n: number, host = '127.0.0.1'): Promise<number[]> {
  const ports: number[] = []
  for (let i = 0; i < n; i++) {
    // Sequential to maximise distinctness; same-tick parallel listen(0)
    // calls can occasionally collide on the same port.
    ports.push(await pickFreePort(host))
  }
  return ports
}
