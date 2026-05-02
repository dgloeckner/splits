import { test as base } from '@playwright/test'
import { ensureSplitsBinary, spawnBackend, type BackendHandle, type BackendOptions, waitForEndedSession } from './helpers/backend'
import { seedRower } from './helpers/rower'
import { OnboardingPage } from './pages/OnboardingPage'
import { HomePage } from './pages/HomePage'
import { WorkoutFlow } from './pages/WorkoutFlow'
import { HistoryPage } from './pages/HistoryPage'
import { LivePage } from './pages/LivePage'

type SeedRowerOpts = { name?: string }

/**
 * Per-test fixtures: a fresh backend (with a chosen fixture CSV), a
 * helper to seed an active rower, page objects, and a session
 * watcher. Tests pull what they need from the function signature.
 */
export type TestFixtures = {
  /** Spawn a fresh splits backend with the given fixture options.
   *  Builds the binary once, reuses on subsequent tests. Auto-killed
   *  in afterEach. */
  startBackend: (opts?: BackendOptions) => Promise<BackendHandle>

  /** Seed a rower via the API and set it active. Returns the rower. */
  seedActiveRower: (opts?: SeedRowerOpts) => Promise<{ id: string }>

  onboarding: OnboardingPage
  home: HomePage
  workoutFlow: WorkoutFlow
  history: HistoryPage
  live: LivePage

  /** Poll /sessions until an ended one shows up; throws on timeout. */
  waitForEndedSession: typeof waitForEndedSession
}

export const test = base.extend<TestFixtures>({
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

  waitForEndedSession: async ({}, use) => use(waitForEndedSession),
})

export { expect } from '@playwright/test'
