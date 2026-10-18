import styles from './BootstrapScreen.module.css'
import { ApiError, NetworkError } from '../api/error'

type Props = {
  state: 'loading' | 'error' | 'offline'
  error?: unknown
  onRetry?: () => void
}

function describe(err: unknown): { title: string; detail: string; url?: string } {
  if (err instanceof NetworkError) {
    const cause =
      err.cause instanceof Error
        ? `${err.cause.name}: ${err.cause.message}`
        : String(err.cause ?? 'unknown')
    return { title: 'Backend nicht erreichbar', detail: cause, url: err.url }
  }
  if (err instanceof ApiError) {
    return {
      title: `Backend-Fehler ${err.status}`,
      detail: err.body || err.message,
      url: err.url,
    }
  }
  if (err instanceof Error) {
    return { title: err.name || 'Fehler', detail: err.message }
  }
  return { title: 'Fehler', detail: String(err) }
}

export function BootstrapScreen({ state, error, onRetry }: Props) {
  return (
    <div className={styles.root} role="status" aria-live="polite">
      <header className={styles.header}>
        <span className={styles.dot} aria-hidden />
        <span className={styles.brand}>SPLITS</span>
      </header>
      <main className={styles.main}>
        {state === 'loading' ? (
          <>
            <div className={styles.spinner} aria-hidden />
            <p className={styles.label}>Verbinde zum Backend…</p>
          </>
        ) : state === 'offline' ? (
          <OfflineBlock onRetry={onRetry} />
        ) : (
          <ErrorBlock error={error} onRetry={onRetry} />
        )}
      </main>
    </div>
  )
}

// Friendly away-from-home state (ADR-0020): the ergo is a LAN-only
// backend, so "unreachable" is an expected situation, not an error.
// With the local-first boot (ADR-0021) only a device that has never
// been at home lands here — say so honestly.
// No stack traces, no URLs — just the fact and a reconnect trigger.
function OfflineBlock({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className={styles.error} data-testid="bootstrap-offline">
      <h1 className={styles.title}>Ergo nicht erreichbar</h1>
      <p className={styles.subtitle}>
        Noch keine Unterwegs-Daten — einmal im Heimnetz öffnen.
      </p>
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Erneut verbinden
        </button>
      )}
    </div>
  )
}

function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, detail, url } = describe(error)
  return (
    <div className={styles.error}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.subtitle}>Versuche neu zu verbinden…</p>
      <pre className={styles.detail}>{detail}</pre>
      {url && <p className={styles.url}>{url}</p>}
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Jetzt erneut versuchen
        </button>
      )}
    </div>
  )
}
