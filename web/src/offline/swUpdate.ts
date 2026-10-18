import { useEffect } from 'react'
import { showToast } from '../app/toastBus'
import { useLiveSession } from '../live/LiveSessionContext'

/**
 * When a new build may take over the page (ADR-0023 §5, FEAT-0016).
 *
 * The service worker registers with `registerType: 'prompt'`: a new
 * worker installs as soon as it is found — its precache warms at home, so
 * the deploy still lands before the away-from-home launch (ADR-0021) — but
 * it only activates when the user says so, or when every tab is closed.
 * An unattended 04:30 deploy must never reload a phone left on the Live
 * view mid-session.
 *
 * So the offer „Neue Version verfügbar — Neu laden" is made right away
 * when the app is idle, and otherwise deferred while a session is open or
 * the Live view is mounted, then made on the next visit to Home or
 * Verlauf.
 */

type ApplyUpdate = () => void

let apply: ApplyUpdate | null = null
let liveViews = 0
let sessionOpen = false
let lastOfferAt = -Infinity

// A toast with an action stays 8 s (toastBus.ts). One offer at a time: a
// rower moving between Home and Verlauf must not stack copies of it.
const OFFER_GAP_MS = 8_000

function busy(): boolean {
  return liveViews > 0 || sessionOpen
}

function offer(): boolean {
  if (!apply || busy()) return false
  const now = Date.now()
  if (now - lastOfferAt < OFFER_GAP_MS) return false
  lastOfferAt = now
  const run = apply
  showToast('Neue Version verfügbar', 'info', { label: 'Neu laden', onClick: run })
  return true
}

/** The registration's onNeedRefresh: a new build is installed and waiting. */
export function updateWaiting(applyUpdate: ApplyUpdate): void {
  apply = applyUpdate
  offer()
}

/** Offer a waiting update now, unless a session is open or Live is up.
 *  Returns whether the toast was shown. */
export function offerPendingUpdate(): boolean {
  return offer()
}

/** Keep the session-open bit in step with the live state. */
export function setSessionOpen(open: boolean): void {
  sessionOpen = open
}

/** Mount once inside the LiveSessionProvider: a session counts as open
 *  from its session_start until its summary arrives. */
export function useSessionHoldsUpdate(): void {
  const { session, summary } = useLiveSession()
  const open = session !== null && summary === null
  useEffect(() => {
    setSessionOpen(open)
  }, [open])
}

/** Marks the Live view as mounted for as long as the calling component is. */
export function useLiveViewHoldsUpdate(): void {
  useEffect(() => {
    liveViews++
    return () => {
      liveViews--
    }
  }, [])
}

/** Home and Verlauf: the places a deferred update is offered. */
export function useOfferPendingUpdate(): void {
  useEffect(() => {
    offerPendingUpdate()
  }, [])
}

export function _resetSwUpdateForTest(): void {
  apply = null
  liveViews = 0
  sessionOpen = false
  lastOfferAt = -Infinity
}
