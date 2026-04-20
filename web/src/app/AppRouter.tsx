import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { ErrorBoundary } from './ErrorBoundary'
import { NotFound } from './NotFound'
import { LiveSessionProvider } from '../live/LiveSessionContext'
import { LivePage } from '../pages/LivePage'
import { HistoryPage } from '../pages/HistoryPage'
import { ProfilePage } from '../pages/ProfilePage'

export function AppRouter() {
  return (
    <ErrorBoundary>
      <LiveSessionProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<LivePage />} />
              <Route path="/historie" element={<HistoryPage />} />
              <Route path="/profil" element={<ProfilePage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </LiveSessionProvider>
    </ErrorBoundary>
  )
}
