import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useRowers } from '../hooks/useRowers'
import { useActiveRower } from '../hooks/useActiveRower'
import { useErgoStatus } from '../offline/ergoStatus'
import { enterOfflineMode, retryReachabilityNow } from '../offline/reachability'
import { BootstrapScreen } from './BootstrapScreen'

export function RowerGate() {
  const rowers = useRowers()
  const active = useActiveRower()
  const { reachable } = useErgoStatus()
  const loc = useLocation()

  // Bootstrap fetch is failing or has failed. Don't treat missing data
  // as "no rower" — that wrongly sends an existing user to onboarding.
  // Away from home (probe says unreachable) this is the friendly
  // offline screen; only when the backend is reachable but failing do
  // we surface diagnostics for a tech user (ADR-0020). Recovery is
  // owned by the reachability probe loop; the button forces a probe
  // and a refetch right now.
  const failure = rowers.failureReason ?? active.failureReason
  const hasFailed = (rowers.failureCount ?? 0) > 0 || (active.failureCount ?? 0) > 0
  if (hasFailed && (!rowers.data || !active.data)) {
    // Reachability still unknown: neither diagnose nor declare offline
    // yet — the first probe decides within seconds (ADR-0021).
    if (reachable === 'unknown') return <BootstrapScreen state="loading" />
    return (
      <BootstrapScreen
        state={reachable === true ? 'error' : 'offline'}
        error={failure}
        onRetry={() => {
          retryReachabilityNow()
          rowers.refetch()
          active.refetch()
        }}
        onOffline={enterOfflineMode}
      />
    )
  }

  if (rowers.isLoading || active.isLoading) {
    return <BootstrapScreen state="loading" />
  }

  const noRower = (rowers.data?.length ?? 0) === 0 || !active.data
  if (noRower) {
    // Only send to onboarding once a fresh fetch THIS session has
    // confirmed there is genuinely no rower. Otherwise an existing
    // user is stranded on onboarding by a stale empty snapshot that
    // the offline cache hydrated from IndexedDB (rowers=[]/active=null
    // are both "successful" queries, so they get persisted). Hold on
    // the loader while the mounted queries revalidate against the
    // network — the live answer then resolves to the app or, if truly
    // unregistered, to onboarding.
    const confirmed = rowers.isFetchedAfterMount && active.isFetchedAfterMount
    if (!confirmed) {
      return <BootstrapScreen state="loading" />
    }
    if (loc.pathname !== '/onboarding') {
      return <Navigate to="/onboarding" replace />
    }
  }
  return <Outlet />
}
