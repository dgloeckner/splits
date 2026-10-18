import type { DefaultOptions } from '@tanstack/react-query'
import { QUERY_GC_TIME } from '../offline/persister'
import { queryRetry } from './retry'

// Global react-query query defaults (main.tsx).
export const queryDefaults = {
  staleTime: 30_000,
  gcTime: QUERY_GC_TIME,
  // Refetch on tab focus so the UI picks up backend changes
  // (new session, DB reset) without a manual reload.
  refetchOnWindowFocus: true,
  retry: queryRetry,
  // ADR-0021: run the queryFn even when navigator.onLine is false, so
  // airplane mode reaches the SW cache instead of pausing forever;
  // only retries wait for `online`. This un-pauses, it never pauses —
  // nothing here is coupled to `reachable` (ADR-0020 stands).
  networkMode: 'offlineFirst',
} satisfies DefaultOptions['queries']
