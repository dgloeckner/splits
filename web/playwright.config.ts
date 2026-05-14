import { defineConfig, devices } from '@playwright/test'

// baseURL is env-driven so per-worker e2e fixtures (slice 0016-05+) can
// point at a dynamic Vite port. The 5173 fallback is for human runs.
const DEFAULT_BASE_URL = 'http://localhost:5173'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_BASE_URL

// Auto-spawn Vite only for human runs. When PLAYWRIGHT_BASE_URL is set
// (agent runs in worktrees, parallel agents share the host) the caller
// is responsible for the dev server — skipping the auto-spawn avoids a
// 5173 bind collision.
const webServer = process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    }

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  webServer,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
