import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchRaceOpponents } from './race'

describe('race opponents api', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parses backend response into camelCase with both opponents present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ghost: {
        source_session_id: 'sess-ghost',
        label: 'ghost',
        t_sec: [0, 1, 2],
        split: [120.0, 119.5, 119.2],
      },
      pb: {
        source_session_id: 'sess-pb',
        label: 'pb',
        t_sec: [0, 1, 2],
        split: [118.0, 117.9, 117.8],
      },
    }), { status: 200 }))

    const r = await fetchRaceOpponents({ workoutId: 'w1', rowerId: 'r1' })
    expect(r.ghost).not.toBeNull()
    expect(r.ghost!.sourceSessionId).toBe('sess-ghost')
    expect(r.ghost!.label).toBe('ghost')
    expect(r.ghost!.tSec).toEqual([0, 1, 2])
    expect(r.ghost!.split).toEqual([120.0, 119.5, 119.2])
    expect(r.pb).not.toBeNull()
    expect(r.pb!.sourceSessionId).toBe('sess-pb')
    expect(r.pb!.label).toBe('pb')
  })

  it('handles null for either field gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ghost: {
        source_session_id: 'sess-ghost',
        label: 'ghost',
        t_sec: [0, 1],
        split: [120.0, 119.5],
      },
      pb: null,
    }), { status: 200 }))

    const r = await fetchRaceOpponents({ workoutId: 'w1', rowerId: 'r1' })
    expect(r.ghost).not.toBeNull()
    expect(r.ghost!.sourceSessionId).toBe('sess-ghost')
    expect(r.pb).toBeNull()
  })

  it('throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }))
    await expect(fetchRaceOpponents({ workoutId: 'w1', rowerId: 'r1' })).rejects.toThrow()
  })

  it('encodes both query params correctly in URL', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ghost: null, pb: null }), { status: 200 }),
    )
    await fetchRaceOpponents({ workoutId: 'w/1 a', rowerId: 'r&2' })
    expect(spy).toHaveBeenCalledTimes(1)
    const url = spy.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/race/opponents?')
    // Parse the query string to verify both params round-trip correctly,
    // independent of which valid encoding (%20 vs +) is used.
    const qs = new URLSearchParams(url.split('?')[1])
    expect(qs.get('workout_id')).toBe('w/1 a')
    expect(qs.get('rower_id')).toBe('r&2')
  })
})
