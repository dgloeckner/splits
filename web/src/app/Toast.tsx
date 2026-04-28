import { useEffect, useState } from 'react'
import styles from './Toast.module.css'

export type ToastTone = 'info' | 'warn'
export type ToastMessage = { id: number; text: string; tone: ToastTone }

let nextId = 0
const listeners = new Set<(m: ToastMessage) => void>()

// showToast publishes a toast message to all mounted ToastHost
// instances. Safe to call from anywhere (including outside React).
export function showToast(text: string, tone: ToastTone = 'info'): void {
  const m: ToastMessage = { id: nextId++, text, tone }
  listeners.forEach((l) => l(m))
}

// ToastHost renders any toasts published via showToast. Mount once
// in the app shell. Each toast auto-dismisses after 4s.
export function ToastHost() {
  const [items, setItems] = useState<ToastMessage[]>([])
  useEffect(() => {
    const fn = (m: ToastMessage) => {
      setItems((prev) => [...prev, m])
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== m.id))
      }, 4000)
    }
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  if (items.length === 0) return null
  return (
    <div className={styles.host} role="status" aria-live="polite">
      {items.map((m) => (
        <div
          key={m.id}
          className={`${styles.toast} ${m.tone === 'warn' ? styles.warn : ''}`}
        >
          {m.text}
        </div>
      ))}
    </div>
  )
}
