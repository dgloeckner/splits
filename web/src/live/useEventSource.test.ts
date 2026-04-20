import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useEventSource } from './useEventSource'
import { MockChannel } from './channel'

describe('useEventSource', () => {
  it('subscribes and relays status + events into reducer state', async () => {
    const ch = new MockChannel()
    const { result } = renderHook(() => useEventSource(ch))

    expect(result.current.status).toBe('idle')

    act(() => ch.setStatus('open'))
    await waitFor(() => expect(result.current.status).toBe('open'))

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
    await waitFor(() => expect(result.current.session?.rower_name).toBe('Daniel'))
  })

  it('closes the channel on unmount', () => {
    const ch = new MockChannel()
    const { unmount } = renderHook(() => useEventSource(ch))
    unmount()
    expect(() => ch.push({ kind: 'ping', id: null, data: {} })).not.toThrow()
  })
})
