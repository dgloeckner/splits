import { describe, it, expect, vi } from 'vitest'
import { fetchRaceOpponents } from './raceOpponents'

describe('fetchRaceOpponents', () => {
  it('parses synth ghost without source_session_id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        ghost: { kind: 'synth', label: 'ghost', t_sec: [0, 5], distance_m: [0, 20] },
        pb: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const got = await fetchRaceOpponents({ workoutId: 'W1', rowerId: 'R1' })
    expect(got.ghost?.kind).toBe('synth')
    expect(got.ghost?.sourceSessionId).toBeUndefined()
    expect(got.pb).toBeNull()
  })

  it('parses session-kind opponents with source ids', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        ghost: { kind: 'session', source_session_id: 'S1', label: 'ghost', t_sec: [0], distance_m: [0] },
        pb:    { kind: 'session', source_session_id: 'S2', label: 'pb',    t_sec: [0], distance_m: [0] },
      }), { status: 200 }),
    )
    const got = await fetchRaceOpponents({ workoutId: 'W1', rowerId: 'R1' })
    expect(got.ghost?.sourceSessionId).toBe('S1')
    expect(got.pb?.sourceSessionId).toBe('S2')
  })

  it('throws on non-OK', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await expect(fetchRaceOpponents({ workoutId: 'W1', rowerId: 'R1' })).rejects.toThrow()
  })
})
