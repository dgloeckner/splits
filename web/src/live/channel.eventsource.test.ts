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

  it('schedules retry with exponential backoff on error', () => {
    // seed 0.5 → jitter = 0, scheduleDelay(1) = 1000ms exactly.
    const ch = newChannel(0.5)
    const states: ChannelStatus[] = []
    ch.subscribe({ onEvent: vi.fn(), onStatus: (s) => states.push(s) })
    FakeEventSource.last().fail()
    expect(states).toContain('reconnecting')
    expect(FakeEventSource.instances.length).toBe(1)

    // Before timer expiry, no new EventSource yet.
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances.length).toBe(1)

    // At backoff (1000ms), the second EventSource is created.
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances.length).toBe(2)
  })

  it('surfaces permanently_disconnected after 5 failures and stops auto-retrying', () => {
    const ch = newChannel(0)
    const states: ChannelStatus[] = []
    ch.subscribe({ onEvent: vi.fn(), onStatus: (s) => states.push(s) })

    for (let i = 0; i < 5; i++) {
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

    for (let i = 0; i < 5; i++) {
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
