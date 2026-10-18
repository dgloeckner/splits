import { ApiError, NetworkError } from './error'

// Global react-query retry policy. 429 never retries (the backend asked
// us to back off). A NetworkError (incl. a GET timeout) retries once:
// each attempt already waited up to GET_TIMEOUT_MS, so more attempts only
// delay the offline fallback on the non-SW path. Everything else retries
// twice.
export function queryRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status === 429) return false
  if (error instanceof NetworkError) return failureCount < 1
  return failureCount < 2
}
