import { useEffect, useState } from 'react'

type Status = 'pending' | 'ok' | 'unreachable'

export default function HealthIndicator() {
  const [status, setStatus] = useState<Status>('pending')

  useEffect(() => {
    let cancelled = false

    fetch('/api/health')
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`)
        return r.json() as Promise<{ status: string }>
      })
      .then((body) => {
        if (cancelled) return
        setStatus(body.status === 'ok' ? 'ok' : 'unreachable')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('unreachable')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const label =
    status === 'pending'
      ? 'checking…'
      : status === 'ok'
        ? 'backend: ok'
        : 'backend: unreachable'

  return (
    <div className={`health health--${status}`} role="status" aria-live="polite">
      <span className="health__dot" aria-hidden />
      <span className="health__label">{label}</span>
    </div>
  )
}
