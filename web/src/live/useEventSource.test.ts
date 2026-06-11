import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useEventSource } from './useEventSource'
import { MockChannel } from './channel'

describe('useEventSource', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('subscribes and relays status + events into reducer state', async () => {
    const ch = new MockChannel()
    const { result } = renderHook(() => useEventSource(ch))

    expect(result.current.state.status).toBe('idle')

    act(() => ch.setStatus('open'))
    await waitFor(() => expect(result.current.state.status).toBe('open'))

    act(() =>
      ch.push({
        kind: 'session_start',
        id: 0,
        data: {
          session_id: 'S1',
          started_at: '2026-04-20T10:00:00Z',
          rower_id: 'R1',
          rower_name: 'Daniel',
          initial_level: 3,
        },
      }),
    )
    await waitFor(() => expect(result.current.state.session?.rower_name).toBe('Daniel'))
  })

  it('closes the channel on unmount', () => {
    const ch = new MockChannel()
    const { unmount } = renderHook(() => useEventSource(ch))
    unmount()
    expect(() => ch.push({ kind: 'ping', id: null, data: {} })).not.toThrow()
  })

  it('hydrates state from sessionStorage on mount and preserves sparklines through snapshot session_start', async () => {
    // Simulate a tab reload: a previous mount persisted state with
    // sparkline points; the new mount must restore them and NOT have
    // them wiped when the SSE replay re-emits the same session_start.
    const persisted = {
      status: 'open',
      session: {
        session_id: 'S1',
        started_at: '2026-04-20T10:00:00Z',
        rower_id: 'R1',
        rower_name: 'Daniel',
        initial_level: 3,
      },
      stroke: null,
      summary: null,
      sparklines: {
        power: [{ time_sec: 2, value: 200 }],
        split: [{ time_sec: 2, value: 132 }],
        dps: [],
        spm: [],
      },
      lastStrokeReceivedAtMs: null,
      smoothed: null,
      sessionStartedAtMs: null,
      phase: null,
    }
    sessionStorage.setItem('splits:live-state', JSON.stringify(persisted))

    const ch = new MockChannel()
    const { result } = renderHook(() => useEventSource(ch))

    expect(result.current.state.sparklines.power).toHaveLength(1)
    expect(result.current.state.session?.session_id).toBe('S1')

    // Snapshot replay: same session_id arrives again.
    act(() =>
      ch.push({
        kind: 'session_start',
        id: 0,
        data: {
          session_id: 'S1',
          started_at: '2026-04-20T10:00:00Z',
          rower_id: 'R1',
          rower_name: 'Daniel',
          initial_level: 3,
        },
      }),
    )

    await waitFor(() => expect(result.current.state.session?.rower_name).toBe('Daniel'))
    expect(result.current.state.sparklines.power).toHaveLength(1)
    expect(result.current.state.sparklines.split).toHaveLength(1)
  })
})
