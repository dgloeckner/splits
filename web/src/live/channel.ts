import type { LiveEvent } from './events'

export type ChannelStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export type Subscriber = {
  onEvent: (e: LiveEvent) => void
  onStatus: (s: ChannelStatus) => void
}

export interface Channel {
  subscribe(sub: Subscriber): void
  close(): void
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

/**
 * Production channel — wraps EventSource.
 *
 * URL: /api/v1/stream (credentials included; same-origin cookie auth).
 * Persists `lastEventId` in localStorage so cold reloads resume
 * (INT-0002 client expectations).
 */
export class EventSourceChannel implements Channel {
  private es: EventSource | null = null
  private sub: Subscriber | null = null
  private readonly storageKey = 'home-ergo:last-event-id'

  subscribe(sub: Subscriber): void {
    this.sub = sub
    sub.onStatus('connecting')

    const last = this.readLastEventId()
    const url = last ? `/api/v1/stream?since=${encodeURIComponent(last)}` : '/api/v1/stream'

    const es = new EventSource(url, { withCredentials: true })
    this.es = es

    es.onopen = () => sub.onStatus('open')
    es.onerror = () => sub.onStatus('error')

    const handle = <T>(kind: Exclude<LiveEvent['kind'], 'ping' | 'eof' | 'error'>) => {
      es.addEventListener(kind, (raw) => {
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
    handle('level_change')
    handle('workout_attached')

    es.addEventListener('ping', () =>
      sub.onEvent({ kind: 'ping', id: null, data: {} as Record<string, never> }),
    )
    es.addEventListener('eof', (raw) => {
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

  close(): void {
    this.es?.close()
    this.es = null
    this.sub?.onStatus('closed')
    this.sub = null
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
