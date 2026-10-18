import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useRowers } from './useRowers'
import { useActiveRower } from './useActiveRower'
import { _resetBootstrapMirrorForTest } from '../offline/bootstrapMirror'

vi.mock('../api/rowers', () => ({
  listRowers: vi.fn(() => new Promise(() => {})),
  getActiveRower: vi.fn(() => new Promise(() => {})),
}))

const r1 = { id: 'r1', name: 'Daniel', color: '#5dd7e4', created_at: '2026-05-03T19:01:59Z' }

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('bootstrap hooks read the mirror as initialData (ADR-0021)', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetBootstrapMirrorForTest()
  })

  it('render the mirrored rower synchronously and still revalidate', () => {
    // Mirror from a previous launch (an hour ago).
    localStorage.setItem(
      'splits:bootstrap',
      JSON.stringify({
        rowers: [r1],
        active: r1,
        savedAt: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    )
    const rowers = renderHook(() => useRowers(), { wrapper }).result.current
    const active = renderHook(() => useActiveRower(), { wrapper }).result.current
    expect(rowers.data).toEqual([r1])
    expect(active.data).toEqual(r1)
    // savedAt is in the past → stale → the network fetch starts at once.
    expect(rowers.isStale).toBe(true)
    expect(rowers.fetchStatus).toBe('fetching')
    expect(active.fetchStatus).toBe('fetching')
  })

  it('start empty without a mirror', () => {
    const rowers = renderHook(() => useRowers(), { wrapper }).result.current
    expect(rowers.data).toBeUndefined()
  })
})
