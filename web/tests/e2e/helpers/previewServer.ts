import { spawn, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitForVite, type ViteHandle } from './viteServer'

const __dirname = dirname(fileURLToPath(import.meta.url))
const webDir = resolve(__dirname, '..', '..', '..')

/** Production build (precached shell + generated SW) into `web/dist`.
 *  Run once per Playwright run by the `offline-preview-build` project.
 *  `outDir` + `version` build a second, distinguishable bundle — the
 *  "next release" a service-worker update test switches to. */
export function buildProductionBundle(opts: { outDir?: string; version?: string } = {}): void {
  const args = ['vite', 'build', ...(opts.outDir ? ['--outDir', opts.outDir] : [])]
  const env = opts.version ? { ...process.env, VERSION: opts.version } : process.env
  const r = spawnSync('npx', args, { cwd: webDir, stdio: 'inherit', env })
  if (r.status !== 0) throw new Error(`vite build failed: status ${r.status}`)
}

/** The version the next-release bundle (`dist-next`) is stamped with. */
export const NEXT_BUILD_VERSION = 'v99.0.0-e2e'
export const NEXT_BUILD_DIR = 'dist-next'

/**
 * Serve `web/dist` with `vite preview`. Its `/api` proxy (inherited
 * from `server.proxy`) targets `backendUrl` via `VITE_BACKEND_URL`.
 */
export async function spawnPreviewServer(opts: {
  port: number
  backendUrl: string
  /** Serve this build instead of `dist` (e.g. NEXT_BUILD_DIR). */
  outDir?: string
}): Promise<ViteHandle> {
  const proc = spawn(
    'npx',
    [
      'vite',
      'preview',
      '--port',
      String(opts.port),
      '--strictPort',
      '--host',
      '127.0.0.1',
      ...(opts.outDir ? ['--outDir', opts.outDir] : []),
    ],
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
