import type { BrowserContext } from '@playwright/test'

// seedRower creates a rower + sets it active using the browser
// context's fetch, so the device_id cookie persists into the page
// session. Call before the first navigation that must bypass the
// RowerGate redirect. URL defaults to the page baseURL (dev server),
// which proxies /api/* to the backend, so cookies land on the right
// origin.
export async function seedRower(context: BrowserContext, name = 'Testrower') {
  const create = await context.request.post('/api/v1/rowers', {
    data: { name, color: '#60a5fa' },
  })
  if (!create.ok()) throw new Error(`create rower: ${create.status()}`)
  const row = (await create.json()) as { id: string }
  const active = await context.request.put('/api/v1/active-rower', {
    data: { rower_id: row.id },
  })
  if (!active.ok()) throw new Error(`set active: ${active.status()}`)
  return row
}
