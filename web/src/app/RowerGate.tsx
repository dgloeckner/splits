import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useRowers } from '../hooks/useRowers'
import { useActiveRower } from '../hooks/useActiveRower'

export function RowerGate() {
  const rowers = useRowers()
  const active = useActiveRower()
  const loc = useLocation()

  if (rowers.isLoading || active.isLoading) return null

  const noRower = (rowers.data?.length ?? 0) === 0 || !active.data
  if (noRower && loc.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  return <Outlet />
}
