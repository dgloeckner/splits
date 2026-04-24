import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWorkout, attachWorkout, getLastWorkout, getWorkout, type WorkoutMode } from './workouts'

const originalFetch = global.fetch

function mockFetch(impl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  ;(global as unknown as { fetch: typeof fetch }).fetch = vi.fn(impl) as unknown as typeof fetch
}

beforeEach(() => {
  mockFetch(async () => new Response('{}', { status: 200 }))
})
afterEach(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = originalFetch
})

describe('workouts api', () => {
  it('createWorkout posts the correct body and returns id', async () => {
    mockFetch(async (url, init) => {
      expect(String(url)).toBe('/api/v1/workouts')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(init?.body as string)).toEqual({
        mode: 'distance',
        params: { meters: 5000 },
        intensity: 'moderat',
        warmup_sec: 300,
        cooldown_sec: 300,
      })
      return new Response(JSON.stringify({ id: 'W1', mode: 'distance', params: { meters: 5000 }, intensity: 'moderat', warmup_sec: 300, cooldown_sec: 300, created_at: '2026-04-23T00:00:00Z' }), { status: 201 })
    })
    const out = await createWorkout({ mode: 'distance', params: { meters: 5000 }, intensity: 'moderat', warmup_sec: 300, cooldown_sec: 300 })
    expect(out.id).toBe('W1')
  })

  it('attachWorkout posts to the attach endpoint', async () => {
    mockFetch(async (url, init) => {
      expect(String(url)).toBe('/api/v1/workouts/W1/attach')
      expect(init?.method).toBe('POST')
      return new Response(null, { status: 204 })
    })
    await attachWorkout('W1')
  })

  it('getLastWorkout returns null on 404', async () => {
    mockFetch(async () => new Response('not found', { status: 404 }))
    const out = await getLastWorkout('R1')
    expect(out).toBeNull()
  })

  it('getLastWorkout returns the workout on 200', async () => {
    mockFetch(async (url) => {
      expect(String(url)).toBe('/api/v1/workouts/last?rower_id=R1')
      return new Response(JSON.stringify({ id: 'W2', mode: 'time', params: { seconds: 600 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-23T00:00:00Z' }), { status: 200 })
    })
    const out = await getLastWorkout('R1')
    expect(out?.id).toBe('W2')
  })

  it('getWorkout fetches by id', async () => {
    mockFetch(async (url) => {
      expect(String(url)).toBe('/api/v1/workouts/W1')
      return new Response(JSON.stringify({ id: 'W1', mode: 'distance', params: { meters: 2000 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-24T00:00:00Z' }), { status: 200 })
    })
    const out = await getWorkout('W1')
    expect(out.id).toBe('W1')
  })

  it('type WorkoutMode includes all four modes', () => {
    const modes: WorkoutMode[] = ['just_row', 'distance', 'time', 'intervals']
    expect(modes).toHaveLength(4)
  })
})
