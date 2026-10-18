import { test as base } from '../fixtures'
import { pickFreePort } from '../helpers/ports'
import { startFaultProxy, type FaultProxyHandle } from '../helpers/faultProxy'
import { spawnPreviewServer } from '../helpers/previewServer'

type PreviewWorkerFixtures = {
  /** Switchable hop between `vite preview` and the worker's backend
   *  (which `startBackend` binds to `backendPort`). */
  fault: FaultProxyHandle & { backendPort: number }
}

/**
 * Fixtures for the `offline-preview` project: the worker's frontend is
 * `vite preview` over the production bundle (built once by the
 * `offline-preview-build` setup project) with service workers allowed,
 * so the generated SW — precached shell + runtime caching — is under
 * test. `/api` goes browser → SW → vite preview → fault proxy → backend.
 */
export const test = base.extend<object, PreviewWorkerFixtures>({
  fault: [
    // Playwright requires a destructuring pattern for the fixtures arg.
    // eslint-disable-next-line no-empty-pattern
    async ({}, provide) => {
      const backendPort = await pickFreePort()
      const proxy = await startFaultProxy(`http://127.0.0.1:${backendPort}`)
      try {
        await provide({ ...proxy, backendPort })
      } finally {
        await proxy.close()
      }
    },
    { scope: 'worker' },
  ],
  viteWorker: [
    async ({ fault }, provide) => {
      const vite = await spawnPreviewServer({ port: await pickFreePort(), backendUrl: fault.url })
      try {
        await provide({ vite, viteUrl: vite.url, backendPort: fault.backendPort })
      } finally {
        await vite.kill()
      }
    },
    { scope: 'worker' },
  ],
})

test.beforeEach(({ fault }) => fault.setMode('pass'))

export { expect } from '@playwright/test'
