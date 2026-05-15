// UX/visual audit — distance flow capture pilot.
//
// Drives the distance workout flow through happy-path + a small set of
// domain-meaningful state variants and captures screenshots at two
// viewports. Every capture also writes a `.layout.json` sidecar with
// layout-level findings (overflow, overlap, whitespace gaps) so the
// critique pass reads PNG + JSON together.
//
// Canonical heuristic checklist: docs/ux-audit-heuristics.md.
//
// Captures land in test-results/ux-audit/distance/<viewport>/<state>.{png,layout.json}.
// This spec is intentionally assertion-light — its job is to PRODUCE
// EVIDENCE for the critique pass, not to fail on its own findings.

import { test } from '../fixtures'
import { captureLayout } from './layout-audit'

const FIXTURE = '../specs/int/fixtures/ipm/session-m3-long.csv'

const PHONE = { width: 390, height: 844 } // iPhone-ish, mobile-first default
const TABLET = { width: 820, height: 1180 } // iPad-ish, landscape-adjacent

const VIEWPORTS = [
  { name: 'phone', size: PHONE },
  { name: 'tablet', size: TABLET },
]

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

for (const v of VIEWPORTS) {
  test.describe(`distance flow — ${v.name} (${v.size.width}x${v.size.height})`, () => {
    test.use({ viewport: v.size })

    test('capture: home, step2 chips, step2 eigene min/default/max, step3 intensities, confirm 500m/HM/Marathon/Eigene', async ({
      startBackend,
      seedActiveRower,
      page,
      home,
      workoutFlow,
    }) => {
      // No frames flowing yet — we are capturing UI states, not running
      // a real session. A short idle timeout keeps the backend healthy
      // through the navigation steps.
      await startBackend({ fixture: FIXTURE, idleTimeout: '120s', fixtureDelay: '600s' })
      await seedActiveRower()

      const out = (state: string) => `../test-results/ux-audit/distance/${v.name}/${state}.png`
      const snap = async (state: string) => {
        const path = out(state)
        await page.screenshot({ path, fullPage: true })
        await captureLayout(page, path)
      }

      // 1. Home — mode picker (Step 1).
      await home.open()
      await snap('01-home')

      // 2. Step 2 — distance presets visible (no Eigene panel yet).
      await home.pickDistance()
      await workoutFlow.expectDistanceStep()
      await snap('02-step2-presets')

      // 3. Step 2 — Eigene panel open at default 3000 m.
      await page.getByRole('button', { name: 'Eigene' }).click()
      await snap('03-step2-eigene-default')

      // 4. Step 2 — Eigene at minimum (clamped to 500 m).
      const minus = page.getByRole('button', { name: /^−$/ })
      for (let i = 0; i < 20; i++) {
        if (await minus.isDisabled()) break
        await minus.click()
      }
      await snap('04-step2-eigene-min')

      // 5. Step 2 — Eigene at maximum (clamped to 42 195 m / Marathon).
      const plus = page.getByRole('button', { name: /^\+$/ })
      for (let i = 0; i < 200; i++) {
        if (await plus.isDisabled()) break
        await plus.click()
      }
      await snap('05-step2-eigene-max')

      // 6. Step 2 → Step 3 (intensity) via the 500 m preset.
      // Reload home to reset the flow rather than fight back-nav semantics.
      await home.open()
      await home.pickDistance()
      await workoutFlow.pickDistancePreset('500 m')
      await snap('06-step3-intensity')

      // 7. Step 3 → Confirm (5 km preset, moderat intensity).
      await home.open()
      await home.pickDistance()
      await workoutFlow.pickDistancePreset('5 km')
      await workoutFlow.pickIntensity('Moderat')
      await snap('07-confirm-5km')

      // (HM/Marathon captures removed per F11 — those distances are
      // out of scope for household rowers.)

      // 10. Confirm — Eigene 3500 m (custom value → label survival).
      await home.open()
      await home.pickDistance()
      await page.getByRole('button', { name: 'Eigene' }).click()
      await page.getByRole('button', { name: /^\+$/ }).click() // 3000 → 3500
      await page.getByRole('button', { name: /übernehmen/i }).click()
      await workoutFlow.pickIntensity('Moderat')
      await snap('10-confirm-eigene-3500')

      // 11. Confirm — toggle warmup/cooldown off (empty optional state).
      await workoutFlow.skipWarmupAndCooldown()
      await snap('11-confirm-no-warmup-cooldown')
    })

    test('capture: live during warmup countdown + work view', async ({
      startBackend,
      seedActiveRower,
      page,
      home,
      workoutFlow,
    }) => {
      // Real frames flow here so we capture genuine live-screen states.
      // A 4 s fixture delay gives us a clean Confirm → Live transition
      // before the first stroke arrives.
      await startBackend({ fixture: FIXTURE, idleTimeout: '30s', fixtureDelay: '4s' })
      await seedActiveRower()

      const out = (state: string) => `../test-results/ux-audit/distance/${v.name}/${state}.png`
      const snap = async (state: string) => {
        const path = out(state)
        await page.screenshot({ path, fullPage: true })
        await captureLayout(page, path)
      }

      await home.open()
      await home.pickDistance()
      await workoutFlow.pickDistancePreset('500 m')
      await workoutFlow.pickIntensity('Moderat')
      // Keep both warmup and cooldown to capture the countdown view.
      await workoutFlow.expectConfirmReady()
      await workoutFlow.start()

      // 12. Live — warmup countdown shortly after Start.
      await page.waitForTimeout(2000)
      await snap('12-live-warmup-countdown')

      // 13. Live — work phase (after warmup ends and a few strokes
      // have flowed). The fixture has ~125 frames over ~5 min.
      await page.waitForTimeout(12_000)
      await snap('13-live-work')
    })

    test('capture: history empty, then after one finished session', async ({
      startBackend,
      seedActiveRower,
      page,
    }) => {
      await startBackend({ fixture: FIXTURE, idleTimeout: '120s', fixtureDelay: '600s' })
      await seedActiveRower()

      const out = (state: string) => `../test-results/ux-audit/distance/${v.name}/${state}.png`
      const snap = async (state: string) => {
        const path = out(state)
        await page.screenshot({ path, fullPage: true })
        await captureLayout(page, path)
      }

      // 14. History — empty (fresh rower, no sessions yet).
      await page.goto('/historie')
      await snap('14-history-empty-sessions')
      await page.goto('/historie/trends')
      await snap('15-history-empty-trends')
      await page.goto('/historie/rekorde')
      await snap('16-history-empty-rekorde')
    })
  })
}
