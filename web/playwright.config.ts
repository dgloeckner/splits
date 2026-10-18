import { defineConfig, devices } from '@playwright/test'

// baseURL is env-driven so per-worker e2e fixtures (slice 0016-05+) can
// point at a dynamic Vite port. The 5173 fallback is for human runs.
const DEFAULT_BASE_URL = 'http://localhost:5173'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_BASE_URL

// Auto-spawn Vite only for human runs. When PLAYWRIGHT_BASE_URL is set
// (agent runs in worktrees, parallel agents share the host) the caller
// is responsible for the dev server — skipping the auto-spawn avoids a
// 5173 bind collision. The worker-scoped Vite fixture in fixtures.ts
// (0016-05) spawns Vite per worker on a dynamic port and overrides
// `baseURL`, so agent runs typically set PLAYWRIGHT_BASE_URL to any
// non-empty value (e.g. `noop`) to suppress this auto-spawn — the
// worker fixture then takes over.
const webServer = process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    }

// Optional escape hatch for when the pinned @playwright/test and the browsers
// on disk drift apart (a sandbox image ships one build, the lockfile wants
// another): point it at any Chromium/Chrome binary. Unset in CI and on
// laptops, where it changes nothing. See AGENTS.md "Cloud sessions".
const CHROMIUM_EXECUTABLE = process.env.PW_CHROMIUM_EXECUTABLE

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // Projects spread a device preset, which sets no launchOptions, so this
    // reaches every project.
    ...(CHROMIUM_EXECUTABLE ? { launchOptions: { executablePath: CHROMIUM_EXECUTABLE } } : {}),
  },
  webServer,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['preview/**'],
    },
    // Issue #3 / ADR-0021: the production service worker under test.
    // `vite build` once, then each worker serves it with `vite preview`
    // (see tests/e2e/preview/fixtures.ts). Service workers allowed.
    {
      name: 'offline-preview-build',
      testMatch: 'preview/build.setup.ts',
    },
    {
      name: 'offline-preview',
      testMatch: 'preview/**/*.spec.ts',
      dependencies: ['offline-preview-build'],
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow' },
    },
  ],
})
