import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from '@tanstack/react-query'

import '@fontsource-variable/space-grotesk/index.css'
import '@fontsource-variable/inter/index.css'
import './styles/tokens.css'
import './styles/reset.css'
import './styles/base.css'

import { AppRouter } from './app/AppRouter'
import { ToastHost, showToast } from './app/Toast'
import { ApiError } from './api/error'

registerSW({ immediate: true })

// On HTTP 429 (rate-limited) surface a brief German toast and skip
// the default retry. Other errors keep TanStack Query's default
// retry behavior (capped at 2 attempts here for queries).
function notifyIfRateLimited(error: unknown) {
  if (error instanceof ApiError && error.status === 429) {
    showToast('Zu viele Anfragen — kurz warten.', 'warn')
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: notifyIfRateLimited,
  }),
  mutationCache: new MutationCache({
    onError: notifyIfRateLimited,
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Refetch on tab focus so the UI picks up backend changes
      // (new session, DB reset) without a manual reload.
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 429) return false
        return failureCount < 2
      },
    },
    mutations: {
      retry: (_failureCount, error) => {
        if (error instanceof ApiError && error.status === 429) return false
        return false
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRouter />
      <ToastHost />
    </QueryClientProvider>
  </StrictMode>,
)
