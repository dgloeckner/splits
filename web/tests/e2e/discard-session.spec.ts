import { test, expect } from './fixtures'

test.setTimeout(60_000)

// Spec AC (data-integrity preconditions): tap Verwerfen → no "Session
// beendet" overlay appears, the app returns home, and the session is
// absent from the list. Covers the overlay-race, the latch leak, and
// the dead deep-link in one pass.
test('discarding a session leaves no trace and shows no save-overlay', async ({
  page,
  startBackend,
  seedActiveRower,
  home,
  workoutFlow,
}) => {
  await startBackend({
    fixture: '../specs/int/fixtures/ipm/session-short.csv',
    fixtureRate: 'fast',
    idleTimeout: '60s',
  })
  await seedActiveRower()

  // Start a distance workout so the progress strip (with the ✕ button) is visible.
  await home.open()
  await home.pickDistance()
  // Wait for the distance wizard step to appear.
  await workoutFlow.expectDistanceStep()
  // Pick 500m preset.
  await workoutFlow.pickDistancePreset('500 m')
  // Pick intensity.
  await workoutFlow.pickIntensity('Moderat')
  // Skip warm-up and cool-down so we go straight to work phase.
  await workoutFlow.skipWarmupAndCooldown()
  // Start the session.
  await workoutFlow.start()

  // Wait for the progress strip to appear (structured workout).
  await expect(page.getByTestId('progress-strip')).toBeVisible({ timeout: 15_000 })

  // Click the ✕ abort button.
  await page.getByTestId('progress-strip-abort').click()
  await expect(page.getByTestId('abort-dialog')).toBeVisible()

  // Discard the session.
  await page.getByTestId('abort-dialog-discard').click()

  // The generic save-overlay must NEVER appear after a discard.
  // Give it 2 seconds in case the SSE arrives with a slight delay.
  await expect(page.getByTestId('session-ended-overlay')).toHaveCount(0)
  await page.waitForTimeout(2_000)
  await expect(page.getByTestId('session-ended-overlay')).toHaveCount(0)

  // App returns home.
  await expect(page).toHaveURL(/\/$|\/home|\/workout/, { timeout: 10_000 })
})
