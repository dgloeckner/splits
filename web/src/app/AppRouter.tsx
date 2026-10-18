import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { ErrorBoundary } from './ErrorBoundary'
import { NotFound } from './NotFound'
import { RowerGate } from './RowerGate'
import { LiveSessionProvider } from '../live/LiveSessionProvider'
import { useBootReconcile } from '../live/useBootReconcile'
import { ChannelReviver } from '../live/ChannelReviver'
import { WorkoutOverlayProvider } from '../pages/live/WorkoutOverlayProvider'
import { LivePage } from '../pages/LivePage'
import { HomePage } from '../pages/HomePage'
import { HistoryPage } from '../pages/HistoryPage'
import { VerlaufTab } from '../pages/history/VerlaufTab'
import { RekordeTab } from '../pages/history/RekordeTab'
import { SessionDetailPage } from '../pages/SessionDetailPage'
import { ProfilePage } from '../pages/ProfilePage'
import { OnboardingPage } from '../pages/OnboardingPage'
import { PairPage } from '../pages/PairPage'
import { WorkoutFlowPage } from '../pages/workout/WorkoutFlowPage'

// BootReconciler mounts `useBootReconcile` exactly once inside the
// LiveSessionProvider so it can reach the live dispatch. Rendered as
// a sibling of the router so it is not torn down on navigation.
function BootReconciler() {
  useBootReconcile()
  return null
}

// TrendsRedirect maps the old ?range= param to the new ?window= format.
function TrendsRedirect() {
  const [params] = useSearchParams()
  const r = params.get('range')
  const w = r === 'year' ? '365d' : r === 'all' ? 'all' : '30d'
  return <Navigate to={`/historie?window=${w}`} replace />
}

export function AppRouter() {
  return (
    <ErrorBoundary>
      <LiveSessionProvider>
        <BootReconciler />
        <ChannelReviver />
        <WorkoutOverlayProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/pair" element={<PairPage />} />
            <Route element={<RowerGate />}>
              <Route element={<AppLayout />}>
                <Route index element={<HomePage />} />
                <Route path="/live" element={<LivePage />} />
                <Route path="/workout/new/:mode" element={<WorkoutFlowPage />} />
                <Route path="/historie" element={<HistoryPage />}>
                  <Route index element={<VerlaufTab />} />
                  <Route path="trends" element={<TrendsRedirect />} />
                  <Route path="rekorde" element={<RekordeTab />} />
                </Route>
                <Route path="/historie/:sessionId" element={<SessionDetailPage />} />
                <Route path="/profil" element={<ProfilePage />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
        </WorkoutOverlayProvider>
      </LiveSessionProvider>
    </ErrorBoundary>
  )
}
