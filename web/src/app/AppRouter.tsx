import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { ErrorBoundary } from './ErrorBoundary'
import { NotFound } from './NotFound'
import { RowerGate } from './RowerGate'
import { LiveSessionProvider } from '../live/LiveSessionContext'
import { LivePage } from '../pages/LivePage'
import { HomePage } from '../pages/HomePage'
import { HistoryPage } from '../pages/HistoryPage'
import { SessionDetailPage } from '../pages/SessionDetailPage'
import { ProfilePage } from '../pages/ProfilePage'
import { OnboardingPage } from '../pages/OnboardingPage'
import { WorkoutFlowPage } from '../pages/workout/WorkoutFlowPage'

export function AppRouter() {
  return (
    <ErrorBoundary>
      <LiveSessionProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route element={<RowerGate />}>
              <Route element={<AppLayout />}>
                <Route index element={<HomePage />} />
                <Route path="/live" element={<LivePage />} />
                <Route path="/workout/new" element={<WorkoutFlowPage />} />
                <Route path="/historie" element={<HistoryPage />} />
                <Route path="/historie/:sessionId" element={<SessionDetailPage />} />
                <Route path="/profil" element={<ProfilePage />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </LiveSessionProvider>
    </ErrorBoundary>
  )
}
