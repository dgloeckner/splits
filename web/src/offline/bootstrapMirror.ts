import type { Rower } from '../api/rowers'

/**
 * Durable, synchronous mirror of the RowerGate bootstrap (ADR-0021):
 * `rowers` + `active-rower` in localStorage, so the app renders from a
 * local snapshot on first paint even when the IndexedDB bag and the SW
 * cache are gone (iOS eviction, a fresh deploy) and the network hangs.
 *
 * Written centrally from the QueryCache (`recordBootstrapQuery`) only
 * when both queries have succeeded with a rower; cleared — never
 * written empty — when a fresh fetch finds no rower, so the gate's
 * onboarding guard keeps working.
 */
export type BootstrapMirror = {
  rowers: Rower[]
  active: Rower
  savedAt: string
}

const KEY = 'splits:bootstrap'

// The halves confirmed so far; seeded from storage so a partial update
// after a reload keeps the stored other half.
let pending: { rowers?: Rower[]; active?: Rower } | null = null

function isRower(v: unknown): v is Rower {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as Rower).id === 'string' &&
    typeof (v as Rower).name === 'string'
  )
}

export function loadBootstrapMirror(): BootstrapMirror | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as BootstrapMirror
    if (
      !v ||
      typeof v !== 'object' ||
      !Array.isArray(v.rowers) ||
      v.rowers.length === 0 ||
      !v.rowers.every(isRower) ||
      !isRower(v.active) ||
      typeof v.savedAt !== 'string' ||
      Number.isNaN(Date.parse(v.savedAt))
    ) {
      return null
    }
    return v
  } catch {
    return null
  }
}

function halves(): { rowers?: Rower[]; active?: Rower } {
  if (!pending) {
    const m = loadBootstrapMirror()
    pending = m ? { rowers: m.rowers, active: m.active } : {}
  }
  return pending
}

function write(): void {
  const { rowers, active } = halves()
  try {
    if (rowers && rowers.length > 0 && active) {
      const m: BootstrapMirror = { rowers, active, savedAt: new Date().toISOString() }
      localStorage.setItem(KEY, JSON.stringify(m))
    } else {
      localStorage.removeItem(KEY)
    }
  } catch {
    // Storage full / blocked: the mirror is a convenience layer.
  }
}

/** QueryCache `onSuccess` hook: mirror the bootstrap queries. */
export function recordBootstrapQuery(queryKey: readonly unknown[], data: unknown): void {
  if (queryKey.length !== 1) return
  const h = halves()
  if (queryKey[0] === 'rowers') {
    h.rowers = Array.isArray(data) && data.length > 0 && data.every(isRower) ? data : undefined
    if (!h.rowers) h.active = undefined
  } else if (queryKey[0] === 'active-rower') {
    h.active = isRower(data) ? data : undefined
  } else {
    return
  }
  write()
}

/** `initialData` + `initialDataUpdatedAt` for a bootstrap query hook. */
export function mirrorInitialData<K extends 'rowers' | 'active'>(
  key: K,
): { initialData?: BootstrapMirror[K]; initialDataUpdatedAt?: number } {
  const m = loadBootstrapMirror()
  if (!m) return {}
  return { initialData: m[key], initialDataUpdatedAt: Date.parse(m.savedAt) }
}

export function _resetBootstrapMirrorForTest(): void {
  pending = null
}
