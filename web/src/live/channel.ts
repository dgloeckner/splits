import type { LiveEvent } from './events'

export type ChannelStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'permanently_disconnected'
  | 'closed'
  | 'error'

export type Subscriber = {
  onEvent: (e: LiveEvent) => void
  onStatus: (s: ChannelStatus) => void
}

export interface Channel {
  subscribe(sub: Subscriber): void
  close(): void
  /**
   * Manually trigger an immediate reconnect attempt and reset the
   * failure counter. Used by the "Erneut verbinden" banner button
   * when the channel has reached `permanently_disconnected`.
   * No-op for channels that don't auto-reconnect (e.g. MockChannel).
   */
  reconnect?(): void
}

/**
 * In-memory test channel. Pushes events to the current subscriber (or
 * buffers until one arrives). Every subscriber gets one implicit
 * `onStatus('idle')` on subscribe so consumers don't need to special-
 * case an initial undefined status.
 */
export class MockChannel implements Channel {
  private sub: Subscriber | null = null
  private buffer: LiveEvent[] = []
  private status: ChannelStatus = 'idle'
  private closed = false

  subscribe(sub: Subscriber): void {
    this.sub = sub
    sub.onStatus(this.status)
    for (const e of this.buffer) sub.onEvent(e)
    this.buffer = []
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.setStatus('closed')
    this.sub = null
  }

  push(e: LiveEvent): void {
    if (this.closed) return
    if (this.sub) this.sub.onEvent(e)
    else this.buffer.push(e)
  }

  setStatus(s: ChannelStatus): void {
    this.status = s
    this.sub?.onStatus(s)
  }
}

// Reconnect schedule (ms). The first two steps are sub-second so a
// PWA cold start that races the service-worker install — a known iOS
// issue where the very first EventSource connect fails generically —
// recovers before the user notices. Past step N each subsequent
// failure caps at MAX_BACKOFF_MS. Jitter is ±25%.
const BACKOFF_STEPS_MS = [
  250, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000,
]
const MAX_BACKOFF_MS = 60_000
// After this many consecutive failed connects (without ever reaching
// `open`), the channel surfaces `permanently_disconnected` and stops
// auto-retrying until `reconnect()` is called explicitly. Bumped from
// 5 → 8 so the front-loaded fast retries don't burn the budget before
// a slow Pi finishes booting Caddy/cert provisioning.
const PERMANENT_FAILURE_AFTER = 8
// If no message (event or ping) arrives for this long, the channel
// assumes the connection is dead and forces a reconnect. Backend pings
// every 20s; this gives one missed ping plus a slack window.
const STALE_TIMEOUT_MS = 35_000

type EventSourceFactory = (url: string) => EventSource

/**
 * Production channel — wraps EventSource with app-level reconnect
 * backoff and a stale-detection watchdog.
 *
 * URL: /api/v1/stream (credentials included; same-origin cookie auth).
 * Persists `lastEventId` in localStorage so cold reloads resume
 * (INT-0002 client expectations).
 *
 * Reconnect policy: on EventSource error or stale-detection trigger,
 * close the current EventSource and schedule a fresh connect with
 * exponential backoff (1,2,4,8,15,30,60s capped, ±25% jitter). After
 * `PERMANENT_FAILURE_AFTER` consecutive failed connects without ever
 * reaching `open`, surface `permanently_disconnected` and stop. The
 * UI's banner can call `reconnect()` to reset and try again.
 */
export class EventSourceChannel implements Channel {
  private es: EventSource | null = null
  private sub: Subscriber | null = null
  private readonly storageKey = 'home-ergo:last-event-id'
  private readonly factory: EventSourceFactory
  private readonly random: () => number
  private failureCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(opts?: { factory?: EventSourceFactory; random?: () => number }) {
    this.factory =
      opts?.factory ??
      ((url: string) => new EventSource(url, { withCredentials: true }))
    this.random = opts?.random ?? Math.random
  }

  subscribe(sub: Subscriber): void {
    // React StrictMode mounts effects twice in dev: subscribe → close
    // → subscribe on the SAME channel instance. close() sets
    // `destroyed = true`, which would make connect() a no-op and
    // leave the channel permanently dead. Resetting the flag here
    // turns close() into a soft tear-down that a re-subscribe can
    // revive — the channel only stays destroyed if no one
    // re-subscribes.
    this.destroyed = false
    this.failureCount = 0
    this.sub = sub
    this.connect()
  }

  close(): void {
    this.destroyed = true
    this.clearTimers()
    this.es?.close()
    this.es = null
    this.sub?.onStatus('closed')
    this.sub = null
  }

  reconnect(): void {
    if (this.destroyed) return
    this.failureCount = 0
    this.clearTimers()
    this.es?.close()
    this.es = null
    this.connect()
  }

  private connect(): void {
    if (this.destroyed || !this.sub) return
    const sub = this.sub
    sub.onStatus(this.failureCount === 0 ? 'connecting' : 'reconnecting')

    const last = this.readLastEventId()
    const url = last
      ? `/api/v1/stream?since=${encodeURIComponent(last)}`
      : '/api/v1/stream'

    const es = this.factory(url)
    this.es = es

    es.onopen = () => {
      this.failureCount = 0
      this.armWatchdog()
      sub.onStatus('open')
    }
    es.onerror = () => this.handleConnectionLost()

    const handle = <T>(
      kind: Exclude<LiveEvent['kind'], 'ping' | 'eof' | 'error'>,
    ) => {
      es.addEventListener(kind, (raw) => {
        this.armWatchdog()
        const ev = raw as MessageEvent
        try {
          const data = JSON.parse(ev.data) as T
          const id = Number(ev.lastEventId)
          if (Number.isFinite(id)) this.writeLastEventId(String(id))
          sub.onEvent({ kind, id, data } as LiveEvent)
        } catch {
          sub.onEvent({
            kind: 'error',
            id: null,
            data: { message: `malformed ${kind} payload` },
          })
        }
      })
    }

    handle('stroke')
    handle('session_start')
    handle('session_end')
    handle('session_finalized')
    handle('level_change')
    handle('workout_attached')
    handle('phase_change')

    es.addEventListener('device', (raw) => {
      this.armWatchdog()
      const ev = raw as MessageEvent
      try {
        const data = JSON.parse(ev.data) as import('./events').DevicePayload
        sub.onEvent({ kind: 'device', id: null, data })
      } catch {
        sub.onEvent({
          kind: 'error',
          id: null,
          data: { message: 'malformed device payload' },
        })
      }
    })

    es.addEventListener('ping', () => {
      this.armWatchdog()
      sub.onEvent({ kind: 'ping', id: null, data: {} as Record<string, never> })
    })
    es.addEventListener('eof', (raw) => {
      this.armWatchdog()
      const ev = raw as MessageEvent
      try {
        const data = JSON.parse(ev.data) as { session_id: string }
        sub.onEvent({ kind: 'eof', id: null, data })
      } catch {
        sub.onEvent({
          kind: 'error',
          id: null,
          data: { message: 'malformed eof payload' },
        })
      }
    })
  }

  private handleConnectionLost(): void {
    if (this.destroyed || !this.sub) return
    this.clearTimers()
    this.es?.close()
    this.es = null
    this.failureCount += 1
    if (this.failureCount >= PERMANENT_FAILURE_AFTER) {
      this.sub.onStatus('permanently_disconnected')
      return
    }
    const delay = this.scheduleDelayMs(this.failureCount)
    this.sub.onStatus('reconnecting')
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  private scheduleDelayMs(failureNumber: number): number {
    const idx = Math.min(failureNumber - 1, BACKOFF_STEPS_MS.length - 1)
    const base = BACKOFF_STEPS_MS[idx] ?? MAX_BACKOFF_MS
    const jitter = base * 0.25 * (this.random() * 2 - 1) // ±25%
    return Math.max(0, Math.round(base + jitter))
  }

  private armWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer)
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null
      this.handleConnectionLost()
    }, STALE_TIMEOUT_MS)
  }

  private clearTimers(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  private readLastEventId(): string | null {
    try {
      return localStorage.getItem(this.storageKey)
    } catch {
      return null
    }
  }

  private writeLastEventId(v: string): void {
    try {
      localStorage.setItem(this.storageKey, v)
    } catch {
      /* ignore */
    }
  }
}
