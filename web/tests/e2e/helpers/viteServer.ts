import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export type ViteHandle = {
  proc: ChildProcess
  url: string
  port: number
  kill: () => Promise<void>
}

/**
 * Spawn a Vite dev server on a fixed port (`--strictPort`) with the
 * backend proxy target wired to the caller's backend URL. The web/
 * directory is the Vite project root.
 *
 * The 0016-05 worker fixture asks for a Vite *per worker*, so concurrent
 * agents in separate worktrees don't share 5173. The `VITE_BACKEND_URL`
 * env var feeds `vite.config.ts`'s proxy target — every `/api/*` request
 * the browser makes is forwarded to the same worker's backend.
 */
export async function spawnViteServer(opts: {
  port: number
  backendUrl: string
}): Promise<ViteHandle> {
  const webDir = resolve(__dirname, '..', '..', '..')
  const env: Record<string, string> = {
    ...process.env,
    VITE_BACKEND_URL: opts.backendUrl,
    // Some shells set FORCE_COLOR; keep stdout/stderr line-buffered.
    FORCE_COLOR: '0',
  }
  // Use the local Vite binary directly to avoid an extra npm shell that
  // would orphan on kill. `--port` + `--strictPort` makes Vite fail fast
  // if the port is taken rather than auto-incrementing.
  const proc = spawn(
    'npx',
    ['vite', '--port', String(opts.port), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: webDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  )
  const tag = `[vite@${proc.pid}]`
  proc.stderr?.on('data', (d) => process.stderr.write(`${tag} ${d}`))
  proc.stdout?.on('data', (d) => process.stderr.write(`${tag} ${d}`))

  const url = `http://127.0.0.1:${opts.port}`
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url + '/', {
        signal: AbortSignal.timeout(500),
      })
      // Vite serves the SPA index on / in dev mode. Any 2xx/3xx means
      // the server bound and is responding.
      if (r.status < 500) {
        r.body?.cancel()
        return {
          proc,
          url,
          port: opts.port,
          kill: () => killVite(proc),
        }
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  await killVite(proc)
  throw new Error(`vite did not come up on ${url} in 60s`)
}

async function killVite(proc: ChildProcess): Promise<void> {
  if (!proc.pid || proc.killed) return
  await new Promise<void>((resolve) => {
    try {
      // Kill the process group so the npx wrapper + child vite both die.
      process.kill(-proc.pid!, 'SIGKILL')
    } catch {
      /* already gone */
    }
    proc.once('exit', () => resolve())
    setTimeout(() => resolve(), 3_000).unref()
  })
}
