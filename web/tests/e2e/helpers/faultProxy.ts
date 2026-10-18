import http from 'node:http'
import type { AddressInfo } from 'node:net'

/** How the proxy answers `/api/**`: forward, never answer, 502, or
 *  drop the connection at once (no network: airplane mode). */
export type FaultMode = 'pass' | 'hang' | '502' | 'refuse'

export type FaultProxyHandle = {
  url: string
  setMode: (mode: FaultMode) => void
  close: () => Promise<void>
}

/**
 * A switchable HTTP hop between `vite preview`'s `/api` proxy and the
 * backend, so the offline-preview specs can inject the real failure
 * shapes of epic #1 — a hanging connection (DuckDNS → private IP off
 * the LAN, Pi powered off) and Caddy's 502 (Pi up, service down) —
 * *below* the service worker. Playwright's `route()` cannot do this:
 * it does not see requests the SW answers.
 */
export async function startFaultProxy(backendUrl: string): Promise<FaultProxyHandle> {
  const target = new URL(backendUrl)
  let mode: FaultMode = 'pass'
  const hanging = new Set<http.ServerResponse>()

  const server = http.createServer((req, res) => {
    if (mode === 'hang') {
      hanging.add(res)
      res.on('close', () => hanging.delete(res))
      return
    }
    if (mode === 'refuse') {
      req.socket.destroy()
      return
    }
    if (mode === '502') {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end('Bad Gateway')
      return
    }
    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    setMode: (m) => {
      mode = m
    },
    close: async () => {
      for (const res of hanging) res.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
