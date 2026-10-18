import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM helpers don't have __dirname.
const __dirname = dirname(fileURLToPath(import.meta.url))

// Path to the pre-built splits binary. The previous implementation
// keyed reuse on file existence, which meant the cached binary was
// kept indefinitely — every backend change after the cache was warmed
// implicitly tested HEAD-of-cache, not the current working tree. See
// .scratch/race-finish-cleanup/issues/11-e2e-binary-cache-staleness.md.
//
// New strategy: defer to `go build` on every fresh Node process.
// Go's own build cache makes the rebuild a ~200 ms no-op when nothing
// changed under backend/ — well under the previous "save 30 s" budget,
// in exchange for correctness. In-process memoisation collapses the
// per-test cost to "one `go build` per Playwright worker".
const BIN_DIR = resolve(__dirname, '../../../node_modules/.cache/splits-e2e')
const BIN_PATH = join(BIN_DIR, 'splits')

let builtThisProcess: string | null = null

export function ensureSplitsBinary(): string {
  if (builtThisProcess) return builtThisProcess
  mkdirSync(dirname(BIN_PATH), { recursive: true })
  const backendDir = resolve(__dirname, '../../../../backend')
  // `go build -o` writes to a temp file in BIN_DIR and atomically
  // renames into place, so concurrent calls from sibling Playwright
  // workers are safe even though each rebuilds redundantly. Go's
  // build cache handles the dedup at the toolchain layer.
  const r = spawnSync('go', ['build', '-o', BIN_PATH, './cmd/splits'], {
    cwd: backendDir,
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    throw new Error(`go build splits failed: status ${r.status}`)
  }
  builtThisProcess = BIN_PATH
  return BIN_PATH
}

export type BackendOptions = {
  /** Fixture CSV path relative to the backend dir, e.g. `../specs/int/fixtures/ipm/session-m1.csv` */
  fixture?: string
  /** Pacing for fixture replay. `'fast'` is the default for e2e. */
  fixtureRate?: 'fast' | 'realtime'
  /** Defer fixture playback so the test can finish setup. Default 6s. */
  fixtureDelay?: string
  /**
   * Start the fixture replayer in a paused state. Default false.
   * Resume via {@link resumeFixture}. Lets race-mode specs align the
   * first stroke with a precise phase boundary (e.g. ATTENTION).
   */
  fixturePaused?: boolean
  /** Sessionizer idle timeout. Default 2s for snappy session_end. */
  idleTimeout?: string
  /**
   * How long distance must be frozen before the sessionizer enters the
   * Paused sub-state. Defaults to 10s; pass a shorter value (e.g.
   * '3s') to make pause-detection fast in E2E tests.
   */
  pauseTimeout?: string
  /**
   * How long a paused session is allowed to linger before it is
   * force-closed. Defaults to 15m; pass a shorter value (e.g. '15s')
   * to test the auto-close path without a long wait.
   */
  resumeWindow?: string
  /** TCP address. Optional — defaults to a dynamically picked free port on 127.0.0.1. */
  addr?: string
}

export type BackendHandle = {
  proc: ChildProcess
  addr: string
  dbPath: string
  /** The updater's update-state.json this backend serves at
   *  /api/v1/update-status (ADR-0023 §4). Absent until a test writes it. */
  updateStatePath: string
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
  // Never the host's /opt/splits/update-state.json.
  const updateStatePath = join(tmp, 'update-state.json')
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
    SPLITS_UPDATE_STATE: updateStatePath,
  }
  if (opts.pauseTimeout) {
    env.SPLITS_PAUSE_TIMEOUT = opts.pauseTimeout
  }
  if (opts.resumeWindow) {
    env.SPLITS_RESUME_WINDOW = opts.resumeWindow
  }
  if (opts.fixture) {
    env.SPLITS_FIXTURE = opts.fixture
    env.SPLITS_FIXTURE_RATE = opts.fixtureRate ?? 'fast'
    env.SPLITS_FIXTURE_DELAY = opts.fixtureDelay ?? '6s'
    if (opts.fixturePaused) {
      env.SPLITS_FIXTURE_PAUSED = '1'
    }
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
          updateStatePath,
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
 * Response shape from POST /test/fixture/resume. The endpoint is
 * idempotent: a successful first call yields {started:true}; later
 * calls return {started:false, reason:"already_running"}. When the
 * backend has no fixture configured the same 200 response carries
 * reason:"no_fixture", letting specs assert "no stroke source" without
 * a separate probe.
 */
export type ResumeFixtureResponse = {
  started: boolean
  reason?: 'already_running' | 'no_fixture'
}

/**
 * Response shape from POST /test/fixture/pause.
 */
export type PauseFixtureResponse = {
  paused: boolean
  reason?: 'already_paused' | 'no_fixture'
}

function backendBaseUrl(handle: BackendHandle): string {
  return handle.addr.startsWith(':')
    ? `http://127.0.0.1${handle.addr}`
    : `http://${handle.addr}`
}

/**
 * POST /test/fixture/resume on the given backend. The endpoint is
 * only mounted when SPLITS_DEV_MODE=1, which spawnBackend always sets.
 * Returns the parsed JSON body; throws on non-2xx so race specs fail
 * fast if the dev gate is misconfigured (e.g. 404).
 */
export async function resumeFixture(
  handle: BackendHandle,
): Promise<ResumeFixtureResponse> {
  const url = `${backendBaseUrl(handle)}/test/fixture/resume`
  const r = await fetch(url, { method: 'POST' })
  if (!r.ok) {
    throw new Error(`resumeFixture: ${url} returned ${r.status}`)
  }
  return (await r.json()) as ResumeFixtureResponse
}

/**
 * POST /test/fixture/pause on the given backend. Stops the fixture
 * replayer mid-stream so the sessionizer stops seeing new distance
 * values, which after PauseTimeout triggers the Paused sub-state.
 * Returns the parsed JSON body; throws on non-2xx.
 */
export async function pauseFixture(
  handle: BackendHandle,
): Promise<PauseFixtureResponse> {
  const url = `${backendBaseUrl(handle)}/test/fixture/pause`
  const r = await fetch(url, { method: 'POST' })
  if (!r.ok) {
    throw new Error(`pauseFixture: ${url} returned ${r.status}`)
  }
  return (await r.json()) as PauseFixtureResponse
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
