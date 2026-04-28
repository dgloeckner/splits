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

// Map known HTTP error statuses to user-facing toasts.
// - 429: rate-limited; suppress retry, briefly inform user.
// - 410: pairing token gone (consumed/expired) — surface global hint
//   so any code path that hits 410 outside PairPage gets a message.
// - 403: pairing-required; suppressed here because RowerStrip surfaces
//   a specific in-place hint.
function notifyForApiError(error: unknown) {
  if (!(error instanceof ApiError)) return
  switch (error.status) {
    case 429:
      showToast('Zu viele Anfragen — kurz warten.', 'warn')
      return
    case 410:
      showToast('Code abgelaufen oder nicht mehr gültig.', 'warn')
      return
    case 403:
      return
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: notifyForApiError,
  }),
  mutationCache: new MutationCache({
    onError: notifyForApiError,
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
