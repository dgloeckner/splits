process.env.TZ = 'UTC'

import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

// Node 25's native `localStorage` global shadows jsdom's Storage. The
// symptom is `localStorage.clear is not a function` and similar. Replace
// `window.localStorage` and the `globalThis.localStorage` getter with a
// pure in-memory Storage shim that implements the full Web Storage API.
function createStorage(): Storage {
  const data = new Map<string, string>()
  const api: Storage = {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(key: string) {
      return data.has(key) ? (data.get(key) as string) : null
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null
    },
    removeItem(key: string) {
      data.delete(key)
    },
    setItem(key: string, value: string) {
      data.set(key, String(value))
    },
  }
  return api
}

function installStorage() {
  const ls = createStorage()
  const ss = createStorage()
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: ls })
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: ss })
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: ls })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: ss })
}

installStorage()
beforeEach(installStorage)

// jsdom does not implement window.matchMedia. Minimal stub that always
// reports no match (so prefers-color-scheme: light returns false → dark).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
  })
}
