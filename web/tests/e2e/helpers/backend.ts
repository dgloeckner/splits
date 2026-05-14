import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickFreePort } from './ports'

// ESM helpers don't have __dirname.
const __dirname = dirname(fileURLToPath(import.meta.url))

// Cached path to a pre-built splits binary. The first test that needs
// the binary builds it once; subsequent tests reuse. Keeps backend
// spawn time per test under ~1s instead of ~30s recompile.
const BIN_DIR = resolve(__dirname, '../../../node_modules/.cache/splits-e2e')
const BIN_PATH = join(BIN_DIR, 'splits')

export function ensureSplitsBinary(): string {
  if (existsSync(BIN_PATH)) return BIN_PATH
  mkdirSync(dirname(BIN_PATH), { recursive: true })
  const backendDir = resolve(__dirname, '../../../../backend')
  const r = spawnSync('go', ['build', '-o', BIN_PATH, './cmd/splits'], {
    cwd: backendDir,
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    throw new Error(`go build splits failed: status ${r.status}`)
  }
  return BIN_PATH
}

export type BackendOptions = {
  /** Fixture CSV path relative to the backend dir, e.g. `../specs/int/fixtures/ipm/session-m1.csv` */
  fixture?: string
  /** Pacing for fixture replay. `'fast'` is the default for e2e. */
  fixtureRate?: 'fast' | 'realtime'
  /** Defer fixture playback so the test can finish setup. Default 6s. */
  fixtureDelay?: string
  /** Sessionizer idle timeout. Default 2s for snappy session_end. */
  idleTimeout?: string
  /** TCP address. Optional — defaults to a dynamically picked free port on 127.0.0.1. */
  addr?: string
}

export type BackendHandle = {
  proc: ChildProcess
  addr: string
  dbPath: string
  kill: () => Promise<void>
}

/**
 * Spawn a fresh splits backend with a private SQLite DB and the
 * configured fixture. Awaits /api/health before returning. Always
 * sets `SPLITS_DEV_MODE=1` so the TLS startup gate is bypassed.
 *
 * If `opts.addr` is omitted the helper picks a free TCP port via the
 * ports helper, so concurrent workers don't collide on a fixed port.
 */
export async function spawnBackend(opts: BackendOptions = {}): Promise<BackendHandle> {
  const bin = ensureSplitsBinary()
  const tmp = mkdtempSync(join(tmpdir(), 'splits-e2e-flow-'))
  const dbPath = join(tmp, 'e2e.db')
  // Legacy specs without `addr` keep the historic 8080 default (they
  // run in serial mode so collisions are avoided that way). New
  // parallel-aware callers should pass an explicit dynamic addr.
  const addr = opts.addr ?? '127.0.0.1:8080'

  const env: Record<string, string> = {
    ...process.env,
    SPLITS_ADDR: addr,
    SPLITS_DB_PATH: dbPath,
    SPLITS_IDLE_TIMEOUT: opts.idleTimeout ?? '2s',
    SPLITS_DEV_MODE: '1',
  }
  if (opts.fixture) {
    env.SPLITS_FIXTURE = opts.fixture
    env.SPLITS_FIXTURE_RATE = opts.fixtureRate ?? 'fast'
    env.SPLITS_FIXTURE_DELAY = opts.fixtureDelay ?? '6s'
  }

  const proc = spawn(bin, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const tag = `[be@${proc.pid}]`
  proc.stderr?.on('data', (d) => process.stderr.write(`${tag} ${d}`))
  proc.stdout?.on('data', (d) => process.stderr.write(`${tag} ${d}`))

  const hostPort = addr.startsWith(':') ? '127.0.0.1' + addr : addr
  const url = `http://${hostPort}/api/health`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url)
      if (r.ok) {
        return {
          proc,
          addr,
          dbPath,
          kill: () => killBackend(proc, hostPort),
        }
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  await killBackend(proc, hostPort)
  throw new Error('backend did not come up in 30s')
}

async function killBackend(proc: ChildProcess, hostPort: string): Promise<void> {
  if (!proc.pid || proc.killed) return
  // Immediate SIGKILL — these are short-lived tests, no graceful
  // shutdown needed and SIGTERM has been racy in practice.
  await new Promise<void>((resolve) => {
    try {
      process.kill(-proc.pid!, 'SIGKILL')
    } catch {
      /* already gone */
    }
    proc.once('exit', () => resolve())
    setTimeout(() => resolve(), 3_000).unref()
  })
  // Block until the chosen port frees up so the next spawn lands on
  // a real fresh backend, not the dying one. A live backend serves
  // /api/health 200; a dead one refuses the connection.
  const healthUrl = `http://${hostPort}/api/health`
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(healthUrl, {
        signal: AbortSignal.timeout(200),
      })
      r.body?.cancel()
    } catch {
      // Connection refused → port closed. Give the kernel a moment
      // to fully reap the listening socket + any TIME_WAIT entries
      // before the next spawn binds the same address.
      await new Promise((r) => setTimeout(r, 600))
      return
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

/**
 * Poll the backend until at least one ended session exists for the
 * given rower. Returns the first such session's id. Throws on timeout.
 *
 * `request` is the Playwright APIRequestContext that shares cookies
 * with the browser context — required after the RequireRower
 * middleware (ADR-0005) gates /api/v1/sessions by paired device.
 */
export async function waitForEndedSession(
  request: { get(url: string): Promise<{ ok(): boolean; json(): Promise<unknown> }> },
  rowerID: string,
  timeoutMs = 20_000,
): Promise<{ id: string; total_distance_m?: number; total_time_sec?: number; total_strokes?: number }> {
  const deadline = Date.now() + timeoutMs
  let lastSeen: unknown = null
  let lastLocal: unknown = null
  while (Date.now() < deadline) {
    try {
      const r = await request.get(
        `/api/v1/sessions?rower_id=${encodeURIComponent(rowerID)}&limit=10`,
      )
      if (r.ok()) {
        const body = (await r.json()) as { sessions?: Array<{ id: string; ended_at?: string; total_distance_m?: number; total_time_sec?: number; total_strokes?: number }> }
        lastSeen = body
        const ended = (body.sessions ?? []).filter((s) => !!s.ended_at)
        if (ended.length > 0) return ended[0]
      }
      // Also peek at the fallback "local-rower" attribution — if the
      // session opened before the holder was set, the row would land
      // there. Helps diagnose the race in test failure messages.
      const r2 = await request.get(`/api/v1/sessions?rower_id=local-rower&limit=10`)
      if (r2.ok()) {
        lastLocal = await r2.json()
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(
    `waitForEndedSession: no ended session for ${rowerID} within ${timeoutMs}ms; lastSeen=${JSON.stringify(lastSeen)}; localFallback=${JSON.stringify(lastLocal)}`,
  )
}
