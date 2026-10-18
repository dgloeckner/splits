import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

/**
 * FEAT-0016 stage 4 (ADR-0023 §4): Profil shows the unattended updater's
 * verdict, read from the update-state.json the real backend serves at
 * /api/v1/update-status. The file is written the way
 * deploy/splits-update.sh writes it; each rewrite stands in for a night's
 * run.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOTS = resolve(__dirname, '..', '..', 'test-results', 'update-status')

function writeState(
  path: string,
  s: { state: string; installed: string; latest: string; result: string; blocked?: string[] },
) {
  writeFileSync(
    path,
    JSON.stringify(
      {
        checked_at: '2026-10-19T04:41:07Z',
        installed: s.installed,
        previous: 'v0.4.0',
        latest: s.latest,
        state: s.state,
        result: s.result,
        message: 'written by the e2e spec',
        blocked: s.blocked ?? [],
      },
      null,
      2,
    ),
  )
}

async function openProfil(page: Page) {
  await page.goto('/profil')
  const card = page.getByTestId('update-status')
  await expect(card).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  return card
}

// Computed accent of the card and colour of its title — what "styled as
// an error" means on screen.
async function look(page: Page) {
  return page.getByTestId('update-status').evaluate((el) => {
    const title = el.querySelector('[data-testid="update-status-title"]')!
    return {
      accent: getComputedStyle(el).borderLeftColor,
      title: getComputedStyle(title).color,
    }
  })
}

test('Profil: behind, then current after the night, and stuck never looks like behind', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  const be = await startBackend()
  await seedActiveRower()

  // No state file yet: a fresh install the updater has not visited.
  let card = await openProfil(page)
  await expect(card).toHaveAttribute('data-state', 'unknown')
  await expect(page.getByTestId('update-status-title')).toHaveText('Update-Status unbekannt')

  // vB is released; tonight's run will take it.
  writeState(be.updateStatePath, { state: 'behind', installed: 'v0.4.1', latest: 'v0.4.2', result: 'would-update' })
  card = await openProfil(page)
  await expect(card).toHaveAttribute('data-state', 'behind')
  await expect(page.getByTestId('update-status-title')).toHaveText('Installiert v0.4.1')
  await expect(page.getByTestId('update-status-detail')).toHaveText(
    'Neu: v0.4.2 — wird heute Nacht installiert',
  )
  const behind = await look(page)
  await card.screenshot({ path: `${SHOTS}/01-behind.png` })

  // The next morning.
  writeState(be.updateStatePath, { state: 'current', installed: 'v0.4.2', latest: 'v0.4.2', result: 'updated' })
  card = await openProfil(page)
  await expect(card).toHaveAttribute('data-state', 'current')
  await expect(page.getByTestId('update-status-title')).toHaveText('Installiert v0.4.2 · aktuell')
  await card.screenshot({ path: `${SHOTS}/02-current.png` })

  // A later release that failed and was rolled back.
  writeState(be.updateStatePath, {
    state: 'stuck',
    installed: 'v0.4.2',
    latest: 'v0.4.3',
    result: 'rolled-back',
    blocked: ['v0.4.3'],
  })
  card = await openProfil(page)
  await expect(card).toHaveAttribute('data-state', 'stuck')
  await expect(page.getByTestId('update-status-title')).toHaveText(
    'Update auf v0.4.3 fehlgeschlagen — läuft weiter auf v0.4.2',
  )
  const stuck = await look(page)
  await card.screenshot({ path: `${SHOTS}/03-stuck.png` })

  // Behind is informational: neither its accent nor its title wears the
  // stuck state's error colour.
  expect(behind.accent).not.toBe(stuck.accent)
  expect(behind.title).not.toBe(stuck.title)

  writeState(be.updateStatePath, { state: 'off', installed: 'v0.4.2', latest: '', result: 'off' })
  card = await openProfil(page)
  await expect(card).toHaveAttribute('data-state', 'off')
  await expect(page.getByTestId('update-status-title')).toHaveText('Automatische Updates aus')
  await page.screenshot({ path: `${SHOTS}/04-off-profil.png`, fullPage: true })
})
