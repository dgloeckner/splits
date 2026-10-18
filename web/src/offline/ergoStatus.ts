import { useSyncExternalStore } from 'react'

// 'unknown' until the first /api/health probe lands (ADR-0021): renders
// neutrally — no offline hero, no diagnostics, starts held.
export type Reachability = 'unknown' | boolean

export type ErgoStatus = {
  reachable: Reachability
  packedAt: string | null
  packedSessions: number
}

const INITIAL: ErgoStatus = { reachable: 'unknown', packedAt: null, packedSessions: 0 }

let status: ErgoStatus = INITIAL
const listeners = new Set<() => void>()

export function getErgoStatus(): ErgoStatus {
  return status
}

export function setErgoStatus(patch: Partial<ErgoStatus>): void {
  const next = { ...status, ...patch }
  if (
    next.reachable === status.reachable &&
    next.packedAt === status.packedAt &&
    next.packedSessions === status.packedSessions
  ) {
    return
  }
  status = next
  for (const fn of listeners) fn()
}

export function subscribeErgoStatus(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useErgoStatus(): ErgoStatus {
  return useSyncExternalStore(subscribeErgoStatus, getErgoStatus, getErgoStatus)
}

export function _resetErgoStatusForTest(): void {
  status = INITIAL
  listeners.clear()
}
