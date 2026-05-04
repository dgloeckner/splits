// ApiError is thrown by fetch helpers in this package on non-2xx
// responses. It carries the HTTP status so callers (and the global
// QueryClient retry/onError policy) can react to specific status
// codes such as 403 (pairing required) or 429 (rate limit).
export class ApiError extends Error {
  status: number
  url?: string
  body?: string
  constructor(status: number, message: string, opts?: { url?: string; body?: string }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.url = opts?.url
    this.body = opts?.body
  }
}

// NetworkError wraps low-level fetch failures (DNS, TCP, TLS, abort,
// CORS, "Load failed" in Safari) so the UI can show a richer message
// including the URL that failed and the underlying cause.
export class NetworkError extends Error {
  url: string
  cause?: unknown
  constructor(url: string, cause: unknown) {
    const causeMsg =
      cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'unknown'
    super(`Network error: ${causeMsg} (${url})`)
    this.name = 'NetworkError'
    this.url = url
    this.cause = cause
  }
}

// Wrap fetch so network failures become NetworkError (with URL) and
// non-2xx responses become ApiError (with URL + body snippet).
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (e) {
    throw new NetworkError(input, e)
  }
}

export async function readApiError(r: Response): Promise<ApiError> {
  let body = ''
  try {
    body = await r.text()
  } catch {
    // ignore body read failure
  }
  const snippet = body.length > 300 ? body.slice(0, 300) + '…' : body
  const detail = snippet ? ` — ${snippet}` : ''
  return new ApiError(r.status, `${r.status} ${r.statusText}${detail}`, {
    url: r.url,
    body: snippet,
  })
}
