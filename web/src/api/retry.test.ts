import { describe, it, expect } from 'vitest'
import { queryRetry } from './retry'
import { ApiError, NetworkError } from './error'

describe('queryRetry', () => {
  it('never retries a 429', () => {
    expect(queryRetry(0, new ApiError(429, 'rate limited'))).toBe(false)
  })

  it('retries other errors twice', () => {
    const err = new ApiError(500, 'boom')
    expect(queryRetry(0, err)).toBe(true)
    expect(queryRetry(1, err)).toBe(true)
    expect(queryRetry(2, err)).toBe(false)
  })

  // A network failure / timeout already waited GET_TIMEOUT_MS; a second
  // and third attempt only delay the offline fallback on the non-SW path.
  it('retries a network error or timeout only once', () => {
    const err = new NetworkError('/api/v1/rowers', new DOMException('timeout', 'TimeoutError'))
    expect(queryRetry(0, err)).toBe(true)
    expect(queryRetry(1, err)).toBe(false)
  })
})
