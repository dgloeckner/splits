// endSessionQueue: pure, React-free localStorage-backed queue of pending
// `session_end` events keyed by `session_id`. Replaces the inline
// `void endSession().catch(() => {})` swallowers in PauseDialog and
// WorkoutProgressStrip so that a backend hiccup or a phone falling
// asleep mid-cooldown can be recovered on the next visible-app moment.
//
// Design:
//   - Storage is a JSON array of session_ids in localStorage under
//     STORAGE_KEY. Deduplicated on enqueue (last-write-wins ordering).
//   - `processPending()` drains the queue serially, calling the
//     configured `endSession(id)`. Successful entries are removed
//     immediately. Failures stay in the queue. At least one success
//     in a drain fires `onSuccess` (used to invalidate the sessions
//     query). Any failure in a drain fires `onPersistentFailure` once
//     (used to raise a toast).
//   - Called on app start and on `online` events from main.tsx.
//   - Pure: dependencies (HTTP call, success/failure hooks) are
//     injected via `configureEndSessionQueue` so the module is testable
//     without React or the network.
//
// FEAT-0015 Slice 2 / ADR-0010.

export const STORAGE_KEY = 'splits:endSessionQueue'

export type EndSessionQueueDeps = {
  endSession: (sessionId: string) => Promise<void>
  onSuccess: () => void
  onPersistentFailure: () => void
}

const defaultDeps: EndSessionQueueDeps = {
  endSession: async () => {
    // Default no-op so the queue is safe to import before configuration.
    throw new Error('endSessionQueue not configured')
  },
  onSuccess: () => {},
  onPersistentFailure: () => {},
}

let deps: EndSessionQueueDeps = defaultDeps
let inflight: Promise<void> | null = null

export function configureEndSessionQueue(next: EndSessionQueueDeps): void {
  deps = next
}

function readQueue(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function writeQueue(items: string[]): void {
  try {
    if (items.length === 0) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // localStorage unavailable (private mode etc.) — best effort only.
  }
}

export function peekPendingEndSessions(): string[] {
  return readQueue()
}

export function enqueueEndSession(sessionId: string): void {
  if (!sessionId) return
  const cur = readQueue()
  if (cur.includes(sessionId)) return
  writeQueue([...cur, sessionId])
}

export async function processPendingEndSessions(): Promise<void> {
  if (inflight) return inflight
  inflight = drain().finally(() => {
    inflight = null
  })
  return inflight
}

async function drain(): Promise<void> {
  const items = readQueue()
  if (items.length === 0) return
  let anySuccess = false
  let anyFailure = false
  for (const id of items) {
    try {
      await deps.endSession(id)
      // Remove this id from the freshly-read queue (other tabs may
      // have mutated it in between; merge by id, not by index).
      const cur = readQueue().filter((x) => x !== id)
      writeQueue(cur)
      anySuccess = true
    } catch {
      anyFailure = true
    }
  }
  if (anySuccess) deps.onSuccess()
  if (anyFailure) deps.onPersistentFailure()
}

export function _resetEndSessionQueueForTests(): void {
  deps = defaultDeps
  inflight = null
}
