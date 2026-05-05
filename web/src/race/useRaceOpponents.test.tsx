import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import * as raceApi from '../api/race'
import type { RaceOpponentsResponse } from '../api/race'
import { useRaceOpponents } from './useRaceOpponents'

const sample: RaceOpponentsResponse = {
  ghost: {
    sourceSessionId: 'sess-ghost',
    label: 'ghost',
    tSec: [0, 1, 2],
    split: [120, 119.5, 119.2],
  },
  pb: {
    sourceSessionId: 'sess-pb',
    label: 'pb',
    tSec: [0, 1, 2],
    split: [118, 117.9, 117.8],
  },
}

describe('useRaceOpponents', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty and does not fetch when workoutId is null', () => {
    const spy = vi.spyOn(raceApi, 'fetchRaceOpponents').mockResolvedValue(sample)
    const { result } = renderHook(() => useRaceOpponents({ workoutId: null, rowerId: 'r1' }))
    expect(result.current).toEqual({ ghost: null, pb: null })
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns empty and does not fetch when rowerId is null', () => {
    const spy = vi.spyOn(raceApi, 'fetchRaceOpponents').mockResolvedValue(sample)
    const { result } = renderHook(() => useRaceOpponents({ workoutId: 'w1', rowerId: null }))
    expect(result.current).toEqual({ ghost: null, pb: null })
    expect(spy).not.toHaveBeenCalled()
  })

  it('fetches once on mount with both ids set and resolves with opponents', async () => {
    const spy = vi.spyOn(raceApi, 'fetchRaceOpponents').mockResolvedValue(sample)
    const { result } = renderHook(() => useRaceOpponents({ workoutId: 'w1', rowerId: 'r1' }))
    await waitFor(() => {
      expect(result.current.ghost).not.toBeNull()
    })
    expect(result.current).toEqual(sample)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ workoutId: 'w1', rowerId: 'r1' })
  })

  it('does not refetch on re-render with same workoutId', async () => {
    const spy = vi.spyOn(raceApi, 'fetchRaceOpponents').mockResolvedValue(sample)
    const { result, rerender } = renderHook(
      (props: { workoutId: string | null; rowerId: string | null }) => useRaceOpponents(props),
      { initialProps: { workoutId: 'w1', rowerId: 'r1' } },
    )
    await waitFor(() => expect(result.current.ghost).not.toBeNull())
    expect(spy).toHaveBeenCalledTimes(1)
    rerender({ workoutId: 'w1', rowerId: 'r1' })
    rerender({ workoutId: 'w1', rowerId: 'r1' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('refetches when workoutId changes to a different value', async () => {
    const second: RaceOpponentsResponse = { ghost: null, pb: sample.pb }
    const spy = vi
      .spyOn(raceApi, 'fetchRaceOpponents')
      .mockResolvedValueOnce(sample)
      .mockResolvedValueOnce(second)
    const { result, rerender } = renderHook(
      (props: { workoutId: string | null; rowerId: string | null }) => useRaceOpponents(props),
      { initialProps: { workoutId: 'w1', rowerId: 'r1' } },
    )
    await waitFor(() => expect(result.current.ghost).not.toBeNull())
    expect(spy).toHaveBeenCalledTimes(1)
    rerender({ workoutId: 'w2', rowerId: 'r1' })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current).toEqual(second))
  })

  it('leaves state empty silently on fetch rejection', async () => {
    vi.spyOn(raceApi, 'fetchRaceOpponents').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useRaceOpponents({ workoutId: 'w1', rowerId: 'r1' }))
    // Wait a microtask for the rejection to settle.
    await waitFor(() => {
      expect(result.current).toEqual({ ghost: null, pb: null })
    })
    // And it stays empty.
    expect(result.current).toEqual({ ghost: null, pb: null })
  })
})
