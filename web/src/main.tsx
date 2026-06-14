import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import {
  QueryClient,
  QueryCache,
  MutationCache,
  defaultShouldDehydrateQuery,
} from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'

import '@fontsource-variable/space-grotesk/index.css'
import '@fontsource-variable/inter/index.css'
import './styles/tokens.css'
import './styles/reset.css'
import './styles/base.css'

import { AppRouter } from './app/AppRouter'
import { ToastHost, showToast } from './app/Toast'
import { ApiError } from './api/error'
import { endSession } from './api/client'
import {
  configureEndSessionQueue,
  processPendingEndSessions,
} from './live/endSessionQueue'
import { idbPersister, PERSIST_MAX_AGE_MS } from './offline/persister'
import { isPersistableQuery } from './offline/persistKeys'
import { startReachabilityProbe } from './offline/reachability'
import { registerPackTriggers } from './offline/pack'

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
      gcTime: PERSIST_MAX_AGE_MS,
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

// Reachability is an uncached round-trip to /api/health (ADR-0019):
// once the SW serves /api reads from cache, query success no longer
// means the ergo is reachable.
startReachabilityProbe()

void navigator.storage?.persist?.()

// FEAT-0015 Slice 2 / ADR-0010: wire the endSession retry queue so
// session-end failures (sleeping phone, dropped Wi-Fi mid-cooldown)
// are recovered on app start and on `online` events. The backend
// `endSession` endpoint is currently keyless ("end whatever is open"
// for the paired rower) and idempotent on 204; passing the id keeps
// the queue keyed correctly for future per-id finalize.
configureEndSessionQueue({
  endSession: async (_sessionId: string) => {
    await endSession()
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
  },
  onPersistentFailure: () => {
    showToast('Session-Ende fehlgeschlagen — wird erneut versucht.', 'warn')
  },
})

// Drain any prior-run entries on boot, and whenever the browser
// reports the network is back.
void processPendingEndSessions()
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void processPendingEndSessions()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: idbPersister,
        maxAge: PERSIST_MAX_AGE_MS,
        buster: __BUILD_SHA__,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            defaultShouldDehydrateQuery(q) && isPersistableQuery(q.queryKey),
        },
      }}
      onSuccess={() => registerPackTriggers(queryClient)}
    >
      <AppRouter />
      <ToastHost />
    </PersistQueryClientProvider>
  </StrictMode>,
)
