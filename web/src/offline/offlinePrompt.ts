import type { QueryCache } from '@tanstack/react-query'
import { NetworkError } from '../api/error'
import { showToast, type ToastAction } from '../app/Toast'
import { loadBootstrapMirror } from './bootstrapMirror'
import { getErgoStatus } from './ergoStatus'
import { enterOfflineMode } from './reachability'

/**
 * Offline on request (ADR-0021 §4): when a request fails at the network
 * level while the probe still says reachable / unknown, *ask* the user
 * whether to continue with the local snapshot („Offline weiter“).
 */
export const OFFLINE_PROMPT_DEBOUNCE_MS = 30_000

let lastPromptAt = -Infinity

/** A snapshot to fall back to: the bootstrap mirror or a packed bag. */
export function hasLocalData(): boolean {
  return loadBootstrapMirror() !== null || getErgoStatus().packedAt !== null
}

/** The „Offline weiter“ action, offered only with local data and in auto. */
export function offlineAction(): ToastAction | undefined {
  if (getErgoStatus().mode !== 'auto' || !hasLocalData()) return undefined
  return { label: 'Offline weiter', onClick: enterOfflineMode }
}

/** Central query-cache error hook. Returns whether it prompted. */
export function maybePromptOffline(error: unknown, now: number = Date.now()): boolean {
  if (!(error instanceof NetworkError)) return false
  const { mode, reachable } = getErgoStatus()
  if (mode !== 'auto' || reachable === false) return false
  if (now - lastPromptAt < OFFLINE_PROMPT_DEBOUNCE_MS) return false
  lastPromptAt = now
  showToast('Ergo antwortet nicht — Offline-Modus?', 'warn', offlineAction())
  return true
}

/**
 * Watch every query attempt — a retry's `failed` and the final `error` —
 * so the prompt comes at the first network failure rather than after
 * the retries (each attempt can already take GET_TIMEOUT_MS).
 */
export function promptOnQueryFailures(cache: QueryCache): () => void {
  return cache.subscribe((event) => {
    if (event.type !== 'updated') return
    const { action } = event
    if (action.type === 'failed' || action.type === 'error') maybePromptOffline(action.error)
  })
}

/** A start (Nur rudern, favorite, workout flow) ran into the network. */
export function showStartFailedToast(): void {
  showToast('Start fehlgeschlagen — Ergo nicht erreichbar?', 'warn', offlineAction())
}

export function _resetOfflinePromptForTest(): void {
  lastPromptAt = -Infinity
}
