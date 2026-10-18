import { test as setup } from '@playwright/test'
import { buildProductionBundle } from '../helpers/previewServer'

setup('build the production bundle for offline-preview', () => {
  setup.setTimeout(180_000)
  buildProductionBundle()
})
