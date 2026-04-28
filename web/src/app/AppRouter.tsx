import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { ErrorBoundary } from './ErrorBoundary'
import { NotFound } from './NotFound'
import { RowerGate } from './RowerGate'
import { LiveSessionProvider } from '../live/LiveSessionContext'
import { WorkoutOverlayProvider } from '../pages/live/WorkoutOverlayContext'
import { LivePage } from '../pages/LivePage'
import { HomePage } from '../pages/HomePage'
import { HistoryPage } from '../pages/HistoryPage'
import { SessionsTab } from '../pages/history/SessionsTab'
import { TrendsTab } from '../pages/history/TrendsTab'
import { RekordeTab } from '../pages/history/RekordeTab'
import { SessionDetailPage } from '../pages/SessionDetailPage'
import { ProfilePage } from '../pages/ProfilePage'
import { OnboardingPage } from '../pages/OnboardingPage'
import { PairPage } from '../pages/PairPage'
import { WorkoutFlowPage } from '../pages/workout/WorkoutFlowPage'

export function AppRouter() {
  return (
    <ErrorBoundary>
      <LiveSessionProvider>
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
                  <Route index element={<SessionsTab />} />
                  <Route path="trends" element={<TrendsTab />} />
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
