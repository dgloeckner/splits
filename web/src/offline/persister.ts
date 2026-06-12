import { del, get, set } from 'idb-keyval'
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'

export const PERSIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const CACHE_KEY = 'splits:rq-cache'

export const idbPersister: Persister = {
  persistClient: (client: PersistedClient) => set(CACHE_KEY, client),
  restoreClient: () => get<PersistedClient>(CACHE_KEY),
  removeClient: () => del(CACHE_KEY),
}
