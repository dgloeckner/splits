import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventSourceChannel, type ChannelStatus } from './channel'

// Minimal fake matching the EventSource shape we depend on.
class FakeEventSource {
  static instances: FakeEventSource[] = []
  static last(): FakeEventSource {
    const inst = FakeEventSource.instances[FakeEventSource.instances.length - 1]
    if (!inst) throw new Error('no FakeEventSource instance')
    return inst
  }
  static reset(): void {
    FakeEventSource.instances = []
  }

  url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {}

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(name: string, fn: (e: MessageEvent) => void): void {
    ;(this.listeners[name] ??= []).push(fn)
  }

  close(): void {
    this.closed = true
  }

  // helpers used by tests
  open(): void {
    this.onopen?.()
  }
  fail(): void {
    this.onerror?.()
  }
  emit(name: string, data: object, lastEventId = ''): void {
    const ev = new MessageEvent(name, {
      data: JSON.stringify(data),
      lastEventId,
    })
    for (const l of this.listeners[name] ?? []) l(ev)
  }
}

function newChannel(seed = 0.5) {
  const factory = (url: string) =>
    new FakeEventSource(url) as unknown as EventSource
  return new EventSourceChannel({ factory, random: () => seed })
}

beforeEach(() => {
  FakeEventSource.reset()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('EventSourceChannel — reconnect', () => {
  it('emits connecting → open on first subscribe', () => {
    const ch = newChannel()
    const states: ChannelStatus[] = []
    ch.subscribe({ onEvent: vi.fn(), onStatus: (s) => states.push(s) })
    FakeEventSource.last().open()
    expect(states).toEqual(['connecting', 'open'])
  })

  it('schedules retry with sub-second first backoff on error', () => {
    // seed 0.5 → jitter = 0, scheduleDelay(1) = 250ms exactly. The
    // front-loaded first step recovers a PWA cold-start race with
    // the service worker before the user notices.
    const ch = newChannel(0.5)
    const states: ChannelStatus[] = []
    ch.subscribe({ onEvent: vi.fn(), onStatus: (s) => states.push(s) })
    FakeEventSource.last().fail()
    expect(states).toContain('reconnecting')
    expect(FakeEventSource.instances.length).toBe(1)

    // Before timer expiry, no new EventSource yet.
    vi.advanceTimersByTime(249)
    expect(FakeEventSource.instances.length).toBe(1)

    // At backoff (250ms), the second EventSource is created.
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances.length).toBe(2)
  })

  it('surfaces permanently_disconnected after 8 failures and stops auto-retrying', () => {
    const ch = newChannel(0)
    const states: ChannelStatus[] = []
    ch.subscribe({ onEvent: vi.fn(), onStatus: (s) => states.push(s) })

    for (let i = 0; i < 8; i++) {
      FakeEventSource.last().fail()
      vi.runAllTimers()
    }

    expect(states[states.length - 1]).toBe('permanently_disconnected')
    const created = FakeEventSource.instances.length
    vi.advanceTimersByTime(120_000)
    expect(FakeEventSource.instances.length).toBe(created)
  })

  it('reconnect() resets failure counter and creates a new EventSource', () => {
    const ch = newChannel(0)
    const states: ChannelStatus[] = []
    ch.subscribe({ onEvent: vi.fn(), onStatus: (s) => states.push(s) })

    for (let i = 0; i < 8; i++) {
      FakeEventSource.last().fail()
      vi.runAllTimers()
    }
    const before = FakeEventSource.instances.length
    expect(states[states.length - 1]).toBe('permanently_disconnected')

    ch.reconnect()
    expect(FakeEventSource.instances.length).toBe(before + 1)
    FakeEventSource.last().open()
    expect(states[states.length - 1]).toBe('open')
  })

  it('forces reconnect after stale-detection timeout', () => {
    const ch = newChannel(0)
    ch.subscribe({ onEvent: vi.fn(), onStatus: vi.fn() })
    FakeEventSource.last().open()
    // Watchdog armed for 35s. Without any event, stale fires.
    expect(FakeEventSource.instances.length).toBe(1)
    vi.advanceTimersByTime(35_000)
    // After stale: connection lost path schedules retry.
    vi.runAllTimers()
    expect(FakeEventSource.instances.length).toBeGreaterThan(1)
  })

  it('arms watchdog on each ping (no stale trigger while pings flow)', () => {
    const ch = newChannel(0)
    ch.subscribe({ onEvent: vi.fn(), onStatus: vi.fn() })
    FakeEventSource.last().open()
    // Send a ping every 20s for 100s; stale never fires.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(20_000)
      FakeEventSource.last().emit('ping', {})
    }
    // Only the initial connect.
    expect(FakeEventSource.instances.length).toBe(1)
  })

  it('successful open after retries clears failure counter', () => {
    const ch = newChannel(0)
    const states: ChannelStatus[] = []
    ch.subscribe({ onEvent: vi.fn(), onStatus: (s) => states.push(s) })

    // Two failures then success.
    FakeEventSource.last().fail()
    vi.runAllTimers()
    FakeEventSource.last().fail()
    vi.runAllTimers()
    FakeEventSource.last().open()
    // Now fail again — should NOT immediately go permanently_disconnected.
    FakeEventSource.last().fail()
    expect(states[states.length - 1]).toBe('reconnecting')
  })

  it('subscribe() after close() revives the channel (StrictMode)', () => {
    // React StrictMode dev-only double-invokes effects: subscribe →
    // close → subscribe on the same channel. The second subscribe
    // must produce a working EventSource, not a permanently dead one.
    const ch = newChannel(0)
    ch.subscribe({ onEvent: vi.fn(), onStatus: vi.fn() })
    ch.close()
    const states: ChannelStatus[] = []
    ch.subscribe({ onEvent: vi.fn(), onStatus: (s) => states.push(s) })
    FakeEventSource.last().open()
    expect(states[states.length - 1]).toBe('open')
  })

  it('close() prevents further reconnect attempts', () => {
    const ch = newChannel(0)
    ch.subscribe({ onEvent: vi.fn(), onStatus: vi.fn() })
    FakeEventSource.last().fail()
    ch.close()
    const created = FakeEventSource.instances.length
    vi.runAllTimers()
    expect(FakeEventSource.instances.length).toBe(created)
  })
})

describe('event kind registration', () => {
  it('registers a listener for every wire event kind', () => {
    const listeners = new Map<string, (ev: MessageEvent) => void>()
    const fakeES = {
      addEventListener: (kind: string, fn: (ev: MessageEvent) => void) => {
        listeners.set(kind, fn)
      },
      close: () => {},
      onopen: null as null | (() => void),
      onerror: null as null | (() => void),
    }
    const ch = new EventSourceChannel({
      factory: () => fakeES as unknown as EventSource,
      random: () => 0,
    })
    const received: string[] = []
    ch.subscribe({
      onEvent: (e) => received.push(e.kind),
      onStatus: () => {},
    })

    const wireKinds = [
      'stroke',
      'session_start',
      'session_end',
      'session_finalized',
      'level_change',
      'workout_attached',
      'phase_change',
    ]
    for (const k of wireKinds) {
      expect(listeners.has(k), `channel must listen for "${k}"`).toBe(true)
    }

    // Round-trip a phase_change payload through the registered listener.
    listeners.get('phase_change')!({
      data: JSON.stringify({
        session_id: 's1',
        from: 'warmup',
        to: 'work',
        at_stroke: 12,
        at_time_sec: 120,
        at_distance_m: 410,
      }),
      lastEventId: '42',
    } as MessageEvent)
    expect(received).toContain('phase_change')
  })
})
