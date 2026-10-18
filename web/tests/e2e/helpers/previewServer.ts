import { spawn, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitForVite, type ViteHandle } from './viteServer'

const __dirname = dirname(fileURLToPath(import.meta.url))
const webDir = resolve(__dirname, '..', '..', '..')

/** Production build (precached shell + generated SW) into `web/dist`.
 *  Run once per Playwright run by the `offline-preview-build` project. */
export function buildProductionBundle(): void {
  const r = spawnSync('npx', ['vite', 'build'], { cwd: webDir, stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`vite build failed: status ${r.status}`)
}

/**
 * Serve `web/dist` with `vite preview`. Its `/api` proxy (inherited
 * from `server.proxy`) targets `backendUrl` via `VITE_BACKEND_URL`.
 */
export async function spawnPreviewServer(opts: {
  port: number
  backendUrl: string
}): Promise<ViteHandle> {
  const proc = spawn(
    'npx',
    ['vite', 'preview', '--port', String(opts.port), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: webDir,
      env: { ...process.env, VITE_BACKEND_URL: opts.backendUrl, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  )
  const tag = `[vite-preview@${proc.pid}]`
  proc.stderr?.on('data', (d) => process.stderr.write(`${tag} ${d}`))
  proc.stdout?.on('data', (d) => process.stderr.write(`${tag} ${d}`))
  return waitForVite(proc, opts.port)
}
