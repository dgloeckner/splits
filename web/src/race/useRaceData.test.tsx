import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as api from '../api/raceOpponents'
import { useRaceData } from './useRaceData'

beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('useRaceData', () => {
  it('returns null opponents until fetch resolves', async () => {
    vi.spyOn(api, 'fetchRaceOpponents').mockResolvedValueOnce({
      ghost: { kind: 'session', sourceSessionId: 'S1', label: 'ghost', tSec: [0, 5], distM: [0, 20] },
      pb: null,
    })
    const { result } = renderHook(() => useRaceData({ workoutId: 'W1', rowerId: 'R1' }))
    expect(result.current.ghost).toBeNull()
    await waitFor(() => expect(result.current.ghost).not.toBeNull())
  })

  it('respects sessionStorage opponent selection (deselected pb hidden)', async () => {
    sessionStorage.setItem('race-opp-selection', JSON.stringify({ ghost: true, pb: false }))
    vi.spyOn(api, 'fetchRaceOpponents').mockResolvedValueOnce({
      ghost: { kind: 'session', sourceSessionId: 'S1', label: 'ghost', tSec: [0], distM: [0] },
      pb: { kind: 'session', sourceSessionId: 'S2', label: 'pb', tSec: [0], distM: [0] },
    })
    const { result } = renderHook(() => useRaceData({ workoutId: 'W1', rowerId: 'R1' }))
    await waitFor(() => expect(result.current.ghost).not.toBeNull())
    expect(result.current.pb).toBeNull()
  })

  it('does not fetch when ids are null', () => {
    const spy = vi.spyOn(api, 'fetchRaceOpponents')
    renderHook(() => useRaceData({ workoutId: null, rowerId: null }))
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns empty when fetch rejects', async () => {
    vi.spyOn(api, 'fetchRaceOpponents').mockRejectedValueOnce(new Error('500'))
    const { result } = renderHook(() => useRaceData({ workoutId: 'W1', rowerId: 'R1' }))
    await waitFor(() => {
      expect(result.current.ghost).toBeNull()
      expect(result.current.pb).toBeNull()
    })
  })
})
