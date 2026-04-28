// ApiError is thrown by fetch helpers in this package on non-2xx
// responses. It carries the HTTP status so callers (and the global
// QueryClient retry/onError policy) can react to specific status
// codes such as 403 (pairing required) or 429 (rate limit).
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}
