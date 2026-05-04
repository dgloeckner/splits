import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useRowers } from '../hooks/useRowers'
import { useActiveRower } from '../hooks/useActiveRower'
import { BootstrapScreen } from './BootstrapScreen'

export function RowerGate() {
  const rowers = useRowers()
  const active = useActiveRower()
  const loc = useLocation()

  // Bootstrap fetch is failing or has failed. Don't treat missing data
  // as "no rower" — that wrongly sends an existing user to onboarding
  // when the backend is just slow to come up. Show the underlying
  // error so a tech user can diagnose; queries keep retrying with
  // backoff in the background.
  const failure = rowers.failureReason ?? active.failureReason
  const hasFailed = (rowers.failureCount ?? 0) > 0 || (active.failureCount ?? 0) > 0
  if (hasFailed && (!rowers.data || !active.data)) {
    return (
      <BootstrapScreen
        state="error"
        error={failure}
        onRetry={() => {
          rowers.refetch()
          active.refetch()
        }}
      />
    )
  }

  if (rowers.isLoading || active.isLoading) {
    return <BootstrapScreen state="loading" />
  }

  const noRower = (rowers.data?.length ?? 0) === 0 || !active.data
  if (noRower && loc.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  return <Outlet />
}
