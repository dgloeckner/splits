import { describe, it, expect } from 'vitest'
import {
  isBootstrapPath,
  isOfflineReadPath,
  isServerFailureStatus,
  SW_NETWORK_TIMEOUT_SECONDS,
} from './swRoutes'

describe('isOfflineReadPath — SW NetworkFirst allowlist', () => {
  it('caches the bootstrap reads that let RowerGate pass', () => {
    expect(isOfflineReadPath('/api/v1/rowers')).toBe(true)
    expect(isOfflineReadPath('/api/v1/active-rower')).toBe(true)
  })

  it('caches the trainer-demo read surfaces', () => {
    expect(isOfflineReadPath('/api/v1/favorites')).toBe(true)
    expect(isOfflineReadPath('/api/v1/sessions')).toBe(true)
    expect(isOfflineReadPath('/api/v1/sessions/abc123')).toBe(true)
    expect(isOfflineReadPath('/api/v1/sessions/abc123/samples')).toBe(true)
    expect(isOfflineReadPath('/api/v1/sessions/abc123/pb-banners')).toBe(true)
    expect(isOfflineReadPath('/api/v1/rowers/r1/pbs')).toBe(true)
    expect(isOfflineReadPath('/api/v1/rowers/r1/lifetime')).toBe(true)
    expect(isOfflineReadPath('/api/v1/rowers/r1/achievements')).toBe(true)
    expect(isOfflineReadPath('/api/v1/rowers/r1/trends')).toBe(true)
    expect(isOfflineReadPath('/api/v1/workouts/w1')).toBe(true)
  })

  it('ignores a trailing slash', () => {
    expect(isOfflineReadPath('/api/v1/rowers/')).toBe(true)
    expect(isOfflineReadPath('/api/v1/sessions/abc123/')).toBe(true)
  })

  it('never caches the reachability probe or the SSE stream', () => {
    expect(isOfflineReadPath('/api/health')).toBe(false)
    expect(isOfflineReadPath('/api/v1/stream')).toBe(false)
    expect(isOfflineReadPath('/api/v1/stream/abc')).toBe(false)
  })

  it('never caches session control, stale-open, or finalize', () => {
    expect(isOfflineReadPath('/api/v1/sessions/stale-open')).toBe(false)
    expect(isOfflineReadPath('/api/v1/sessions/abc123/finalize')).toBe(false)
    expect(isOfflineReadPath('/api/v1/session/start')).toBe(false)
    expect(isOfflineReadPath('/api/v1/session/end')).toBe(false)
    expect(isOfflineReadPath('/api/v1/session/active')).toBe(false)
    expect(isOfflineReadPath('/api/v1/session/race-go')).toBe(false)
  })

  it('never caches the live workouts/last lookup or a bare rower fetch', () => {
    expect(isOfflineReadPath('/api/v1/workouts/last')).toBe(false)
    expect(isOfflineReadPath('/api/v1/rowers/r1')).toBe(false)
    expect(isOfflineReadPath('/api/v1/rowers/r1/unknown')).toBe(false)
  })

  it('does not match unrelated or non-api paths', () => {
    expect(isOfflineReadPath('/index.html')).toBe(false)
    expect(isOfflineReadPath('/api/v2/rowers')).toBe(false)
    expect(isOfflineReadPath('/api/v1/workouts')).toBe(false)
  })
})

describe('isBootstrapPath — never-expiring SW route', () => {
  it('matches only the RowerGate bootstrap reads', () => {
    expect(isBootstrapPath('/api/v1/rowers')).toBe(true)
    expect(isBootstrapPath('/api/v1/rowers/')).toBe(true)
    expect(isBootstrapPath('/api/v1/active-rower')).toBe(true)
    expect(isBootstrapPath('/api/v1/rowers/r1/pbs')).toBe(false)
    expect(isBootstrapPath('/api/v1/sessions')).toBe(false)
    expect(isBootstrapPath('/api/health')).toBe(false)
  })

  it('is a subset of the offline-read allowlist', () => {
    expect(isOfflineReadPath('/api/v1/rowers')).toBe(true)
    expect(isOfflineReadPath('/api/v1/active-rower')).toBe(true)
  })
})

describe('isServerFailureStatus — 5xx falls back to the SW cache', () => {
  it('treats 5xx (proxy up, service down) as a network failure', () => {
    expect(isServerFailureStatus(500)).toBe(true)
    expect(isServerFailureStatus(502)).toBe(true)
    expect(isServerFailureStatus(504)).toBe(true)
  })

  it('passes 2xx/4xx through — 403 (pairing) must reach the page', () => {
    expect(isServerFailureStatus(200)).toBe(false)
    expect(isServerFailureStatus(403)).toBe(false)
    expect(isServerFailureStatus(404)).toBe(false)
    expect(isServerFailureStatus(429)).toBe(false)
  })
})

describe('SW_NETWORK_TIMEOUT_SECONDS', () => {
  it('falls back to the cache within a few seconds', () => {
    expect(SW_NETWORK_TIMEOUT_SECONDS).toBeGreaterThan(0)
    expect(SW_NETWORK_TIMEOUT_SECONDS).toBeLessThanOrEqual(5)
  })
})
