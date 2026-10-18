import { del, get, set } from 'idb-keyval'
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'

export const PERSIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// Version of the *shape* of everything persisted (react-query bag and
// pack cursor). BUMP BY HAND ONLY WHEN A PERSISTED RESPONSE SHAPE
// CHANGES — not per build: the bag must survive a deploy, which
// autoUpdate installs at home right before the away-from-home launch
// (ADR-0021).
export const PERSIST_SCHEMA_VERSION = 1
export const PERSIST_BUSTER = String(PERSIST_SCHEMA_VERSION)

// react-query's gcTime must outlive the persisted bag (or packed
// queries vanish from it), but it is handed to setTimeout unclamped and
// browsers fire any delay > 2^31-1 ms (~24.8 days) immediately — 30 days
// GC'd every unobserved query right after its fetch. Infinity disables
// the timer; the pack prunes what it no longer keeps (pack.ts).
export const QUERY_GC_TIME = Infinity

const CACHE_KEY = 'splits:rq-cache'

export const idbPersister: Persister = {
  persistClient: (client: PersistedClient) => set(CACHE_KEY, client),
  restoreClient: () => get<PersistedClient>(CACHE_KEY),
  removeClient: () => del(CACHE_KEY),
}
