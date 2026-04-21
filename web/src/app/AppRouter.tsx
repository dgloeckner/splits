import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { ErrorBoundary } from './ErrorBoundary'
import { NotFound } from './NotFound'
import { RowerGate } from './RowerGate'
import { LiveSessionProvider } from '../live/LiveSessionContext'
import { LivePage } from '../pages/LivePage'
import { HistoryPage } from '../pages/HistoryPage'
import { SessionDetailPage } from '../pages/SessionDetailPage'
import { ProfilePage } from '../pages/ProfilePage'
import { OnboardingPage } from '../pages/OnboardingPage'

export function AppRouter() {
  return (
    <ErrorBoundary>
      <LiveSessionProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route element={<RowerGate />}>
              <Route element={<AppLayout />}>
                <Route index element={<LivePage />} />
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
