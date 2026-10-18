import { test as setup } from '@playwright/test'
import { buildProductionBundle, NEXT_BUILD_DIR, NEXT_BUILD_VERSION } from '../helpers/previewServer'

setup('build the production bundle for offline-preview', () => {
  setup.setTimeout(180_000)
  buildProductionBundle()
})

// sw-update.spec.ts: a second, distinguishable build the preview server
// switches to, standing in for the release an unattended deploy installs.
setup('build the next-release bundle for the SW update spec', () => {
  setup.setTimeout(180_000)
  buildProductionBundle({ outDir: NEXT_BUILD_DIR, version: NEXT_BUILD_VERSION })
})
