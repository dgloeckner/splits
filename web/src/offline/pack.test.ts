import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

const store = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k: string) => store.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
  del: vi.fn(async (k: string) => void store.delete(k)),
}))

const trends = (w: string) => ({
  window: w,
  from: '',
  to: '',
  points: [
    { t: '2026-06-01T10:00:00Z', session_id: 'S1' },
    { t: '2026-06-10T10:00:00Z', session_id: 'S2' },
  ],
  series: [],
  totals: { distance_m: 0, active_sec: 0, sessions: 2 },
  stats_version: 5,
})

vi.mock('../api/client', () => ({
  getRowerAchievements: vi.fn(async () => []),
  getRowerLifetime: vi.fn(async () => ({
    total_distance_m: 1, total_active_sec: 1, total_strokes: 1,
    total_sessions: 2, stats_version: 5,
  })),
  getRowerPBs: vi.fn(async () => ({ distance: [], window: [], workout: [] })),
  getRowerTrends: vi.fn(async (_id: string, w: string) => trends(w)),
  getSamples: vi.fn(async () => []),
  getSession: vi.fn(async (id: string) => ({ id, workout_id: `W-${id}` })),
}))
vi.mock('../api/rowers', () => ({
  getActiveRower: vi.fn(async () => ({ id: 'R1', name: 'T', color: '#fff', created_at: '' })),
}))
vi.mock('../api/workouts', () => ({
  getWorkout: vi.fn(async (id: string) => ({ id, mode: 'time' })),
}))

import * as client from '../api/client'
import * as rowers from '../api/rowers'
import { packIfStale, onAppVisible, _resetPackForTest } from './pack'
import { getErgoStatus, _resetErgoStatusForTest } from './ergoStatus'
import type { OfflineCursor } from './cursor'

const CURSOR_KEY = 'splits:offline-cursor'
const qcOpts = { defaultOptions: { queries: { retry: false } } }

describe('packIfStale', () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
    vi.useFakeTimers({ now: new Date('2026-06-12T10:00:00Z') })
    _resetPackForTest()
    _resetErgoStatusForTest()
  })
  afterEach(() => vi.useRealTimers())

  it('full pack on empty cursor: trends ×3, records, last sessions, cursor written', async () => {
    const qc = new QueryClient(qcOpts)
    await packIfStale(qc)
    expect(client.getRowerTrends).toHaveBeenCalledTimes(3)
    expect(client.getRowerPBs).toHaveBeenCalledWith('R1')
    expect(client.getRowerAchievements).toHaveBeenCalledWith('R1')
    expect(client.getSession).toHaveBeenCalledTimes(2)
    expect(client.getSamples).toHaveBeenCalledTimes(2)
    const cursor = store.get(CURSOR_KEY) as OfflineCursor
    expect(cursor.statsVersion).toBe(5)
    expect(cursor.rowerId).toBe('R1')
    // newest first
    expect(cursor.sessionIds).toEqual(['S2', 'S1'])
    expect(getErgoStatus()).toMatchObject({ packedSessions: 2 })
    expect(getErgoStatus().packedAt).not.toBeNull()
  })

  it('cursor hit: probe only, no trends fetch', async () => {
    const qc = new QueryClient(qcOpts)
    await packIfStale(qc)
    vi.clearAllMocks()
    _resetPackForTest()
    await packIfStale(qc)
    expect(client.getRowerLifetime).toHaveBeenCalledTimes(1)
    expect(client.getRowerTrends).not.toHaveBeenCalled()
  })

  it('version bump: full pack again, immutable cached sessions not refetched', async () => {
    const qc = new QueryClient(qcOpts)
    await packIfStale(qc)
    vi.clearAllMocks()
    _resetPackForTest()
    vi.mocked(client.getRowerLifetime).mockResolvedValueOnce({
      total_distance_m: 1, total_active_sec: 1, total_strokes: 1,
      total_sessions: 3, stats_version: 6,
    })
    await packIfStale(qc)
    expect(client.getRowerTrends).toHaveBeenCalledTimes(3)
    // S1/S2 already in the cache with staleTime: Infinity
    expect(client.getSession).not.toHaveBeenCalled()
  })

  it('buildSha mismatch forces a full pack despite matching version', async () => {
    const qc = new QueryClient(qcOpts)
    store.set(CURSOR_KEY, {
      rowerId: 'R1', statsVersion: 5, buildSha: 'someone-elses-build',
      packedAt: '2026-06-12T09:00:00.000Z', sessionIds: ['S2', 'S1'],
    } satisfies OfflineCursor)
    await packIfStale(qc)
    expect(client.getRowerTrends).toHaveBeenCalledTimes(3)
  })

  it('pack older than 24h forces a full pack (rolling-window drift)', async () => {
    const qc = new QueryClient(qcOpts)
    await packIfStale(qc)
    vi.clearAllMocks()
    _resetPackForTest()
    vi.setSystemTime(new Date('2026-06-13T11:00:00Z'))
    await packIfStale(qc)
    expect(client.getRowerTrends).toHaveBeenCalledTimes(3)
  })

  it('a failing pack step writes no cursor', async () => {
    const qc = new QueryClient(qcOpts)
    vi.mocked(client.getRowerTrends).mockRejectedValueOnce(new Error('boom'))
    await packIfStale(qc)
    expect(store.get(CURSOR_KEY)).toBeUndefined()
  })

  it('a failing probe stops the pack; Stand survives from the cursor', async () => {
    // The pack no longer owns `reachable` (ADR-0019: that's the
    // /api/health probe's job). It just stops on a failed fetch and
    // leaves the Stand label hydrated from the cursor.
    store.set(CURSOR_KEY, {
      rowerId: 'R1', statsVersion: 5, buildSha: 'x',
      packedAt: '2026-06-11T09:00:00.000Z', sessionIds: ['S2'],
    } satisfies OfflineCursor)
    const qc = new QueryClient(qcOpts)
    vi.mocked(rowers.getActiveRower).mockRejectedValueOnce(new Error('timeout'))
    await packIfStale(qc)
    expect(getErgoStatus()).toMatchObject({
      packedAt: '2026-06-11T09:00:00.000Z',
      packedSessions: 1,
    })
    expect(client.getRowerTrends).not.toHaveBeenCalled()
  })

  it('prune removes sessions outside the keep-set and foreign-rower aggregates', async () => {
    const qc = new QueryClient(qcOpts)
    qc.setQueryData(['sessions', 'OLD'], { id: 'OLD' })
    qc.setQueryData(['sessions', 'OLD', 'samples'], [])
    qc.setQueryData(['workout', 'W-OLD'], { id: 'W-OLD' })
    qc.setQueryData(['rower-trends', 'R9', '30d'], { points: [] })
    qc.setQueryData(['rower-pbs', 'R9'], {})
    await packIfStale(qc)
    expect(qc.getQueryData(['sessions', 'OLD'])).toBeUndefined()
    expect(qc.getQueryData(['sessions', 'OLD', 'samples'])).toBeUndefined()
    expect(qc.getQueryData(['workout', 'W-OLD'])).toBeUndefined()
    expect(qc.getQueryData(['rower-trends', 'R9', '30d'])).toBeUndefined()
    expect(qc.getQueryData(['rower-pbs', 'R9'])).toBeUndefined()
    // keep-set intact
    expect(qc.getQueryData(['sessions', 'S2'])).toBeDefined()
    expect(qc.getQueryData(['workout', 'W-S2'])).toBeDefined()
    expect(qc.getQueryData(['rower-trends', 'R1', '30d'])).toBeDefined()
  })

  it('resume guard: a fresh successful probe suppresses onAppVisible for 15 min', async () => {
    const qc = new QueryClient(qcOpts)
    await packIfStale(qc)
    vi.clearAllMocks()
    onAppVisible(qc)
    await vi.runAllTimersAsync()
    expect(client.getRowerLifetime).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-06-12T10:16:00Z'))
    onAppVisible(qc)
    await vi.runAllTimersAsync()
    expect(client.getRowerLifetime).toHaveBeenCalledTimes(1)
  })

  it('failure does not arm the guard: next visible retries immediately', async () => {
    const qc = new QueryClient(qcOpts)
    vi.mocked(rowers.getActiveRower).mockRejectedValueOnce(new Error('down'))
    await packIfStale(qc)
    vi.clearAllMocks()
    onAppVisible(qc)
    await vi.runAllTimersAsync()
    expect(rowers.getActiveRower).toHaveBeenCalledTimes(1)
  })
})
