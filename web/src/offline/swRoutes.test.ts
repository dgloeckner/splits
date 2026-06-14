import { describe, it, expect } from 'vitest'
import { isOfflineReadPath } from './swRoutes'

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
