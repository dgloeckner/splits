import { test as base } from '@playwright/test'
import { ensureSplitsBinary, spawnBackend, type BackendHandle, type BackendOptions, waitForEndedSession } from './helpers/backend'
import { seedRower } from './helpers/rower'
import { pickFreePort } from './helpers/ports'
import { spawnViteServer, type ViteHandle } from './helpers/viteServer'
import { OnboardingPage } from './pages/OnboardingPage'
import { HomePage } from './pages/HomePage'
import { WorkoutFlow } from './pages/WorkoutFlow'
import { HistoryPage } from './pages/HistoryPage'
import { LivePage } from './pages/LivePage'
import { RaceFlowPage } from './pages/RaceFlowPage'

type SeedRowerOpts = { name?: string }

/**
 * Per-test fixtures: a fresh backend (with a chosen fixture CSV), a
 * helper to seed an active rower, page objects, and a session
 * watcher. Tests pull what they need from the function signature.
 *
 * The worker-scoped fixtures (`viteWorker`, `baseURL` override) added
 * in 0016-05 give each Playwright worker its own Vite + backend port
 * pair, so up to 5 parallel agents in different worktrees can run
 * E2E suites concurrently without colliding on 5173 / 8080.
 */
export type WorkerFixtures = {
  /**
   * Worker-scoped Vite dev server + reserved backend port. Spawned at
   * worker startup, torn down at worker teardown. Tests reading
   * `baseURL` automatically get this worker's URL.
   *
   * The reserved `backendPort` is *not* yet bound — `startBackend`
   * picks it up via the per-test `backendDefaults` fixture so the
   * Vite proxy points at the same worker's backend.
   */
  viteWorker: {
    vite: ViteHandle
    viteUrl: string
    backendPort: number
  }
}

export type TestFixtures = {
  /** Spawn a fresh splits backend with the given fixture options.
   *  Builds the binary once, reuses on subsequent tests. Auto-killed
   *  in afterEach. If a worker-scoped backend port is reserved
   *  (`viteWorker.backendPort`) and the caller does not pass an
   *  explicit `addr`, the helper binds to that reserved port so the
   *  per-worker Vite proxy resolves correctly. */
  startBackend: (opts?: BackendOptions) => Promise<BackendHandle>

  /** Seed a rower via the API and set it active. Returns the rower. */
  seedActiveRower: (opts?: SeedRowerOpts) => Promise<{ id: string }>

  onboarding: OnboardingPage
  home: HomePage
  workoutFlow: WorkoutFlow
  history: HistoryPage
  live: LivePage
  raceFlow: RaceFlowPage

  /** Poll /sessions until an ended one shows up; throws on timeout.
   *  Uses the BrowserContext.request so the polling shares the
   *  paired device_id cookie set during seedActiveRower. */
  waitForEndedSession: (
    rowerID: string,
    timeoutMs?: number,
  ) => ReturnType<typeof waitForEndedSession>
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // ── Worker-scoped ────────────────────────────────────────────────
  viteWorker: [
    async ({}, use) => {
      // Reserve two ports up front. The backend port stays unbound
      // until the per-test `startBackend` claims it; Vite binds its
      // port immediately so the proxy is live for the whole worker.
      const backendPort = await pickFreePort()
      const vitePort = await pickFreePort()
      const backendUrl = `http://127.0.0.1:${backendPort}`
      const vite = await spawnViteServer({ port: vitePort, backendUrl })
      try {
        await use({ vite, viteUrl: vite.url, backendPort })
      } finally {
        await vite.kill()
      }
    },
    { scope: 'worker' },
  ],

  // Override Playwright's `baseURL` so the browser context picks up
  // the worker's Vite URL. Worker scope: same Vite for the whole
  // worker's test list.
  baseURL: [
    async ({ viteWorker }, use) => {
      await use(viteWorker.viteUrl)
    },
    { scope: 'worker' },
  ],

  // ── Per-test ─────────────────────────────────────────────────────
  // `startBackend` does NOT depend on the worker-scoped Vite fixture:
  // backend-only tests (parallel-sanity, live-view-real-backend with
  // its own serial 8080 lock, etc.) skip Vite entirely. UI tests pull
  // the worker's `viteWorker.backendPort` and pass it as `addr` so the
  // Vite proxy resolves to the same backend.
  startBackend: async ({}, use) => {
    let handle: BackendHandle | null = null
    await use(async (opts) => {
      ensureSplitsBinary()
      handle = await spawnBackend(opts)
      return handle
    })
    if (handle) await handle.kill()
  },

  seedActiveRower: async ({ context }, use) => {
    await use(async (opts = {}) => {
      // Seed BEFORE the page navigates. The first POST to /rowers
      // grounds a fresh device_id on this BrowserContext (the backend
      // middleware sets the cookie when absent), and the SAME cookie
      // is then carried into the PUT /active-rower call. By the time
      // the test calls home.open(), RowerGate's first fetch already
      // sees the paired active rower, so no cache-bust reload is
      // needed and we never flash the onboarding screen.
      return seedRower(
        context,
        opts.name ?? 'Tester-' + Math.random().toString(36).slice(2, 8),
      )
    })
  },

  onboarding: async ({ page }, use) => use(new OnboardingPage(page)),
  home: async ({ page }, use) => use(new HomePage(page)),
  workoutFlow: async ({ page }, use) => use(new WorkoutFlow(page)),
  history: async ({ page }, use) => use(new HistoryPage(page)),
  live: async ({ page }, use) => use(new LivePage(page)),
  raceFlow: async ({ page }, use) => use(new RaceFlowPage(page)),

  waitForEndedSession: async ({ context }, use) =>
    use((rowerID, timeoutMs) =>
      waitForEndedSession(context.request, rowerID, timeoutMs),
    ),
})

export { expect } from '@playwright/test'
