export type ToastTone = 'info' | 'warn'
export type ToastAction = { label: string; onClick: () => void }
export type ToastMessage = { id: number; text: string; tone: ToastTone; action?: ToastAction }

let nextId = 0
const listeners = new Set<(m: ToastMessage) => void>()

// showToast publishes a toast message to all mounted ToastHost
// instances. Safe to call from anywhere (including outside React).
// An optional action renders a button; such a toast stays 8 s.
export function showToast(text: string, tone: ToastTone = 'info', action?: ToastAction): void {
  const m: ToastMessage = { id: nextId++, text, tone, action }
  listeners.forEach((l) => l(m))
}

// subscribeToasts registers a listener for published toasts and returns
// the unsubscribe function. ToastHost is the only subscriber.
export function subscribeToasts(fn: (m: ToastMessage) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
