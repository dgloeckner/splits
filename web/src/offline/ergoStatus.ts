import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'

export type ErgoStatus = {
  reachable: boolean
  packedAt: string | null
  packedSessions: number
}

const INITIAL: ErgoStatus = { reachable: true, packedAt: null, packedSessions: 0 }

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

export function attachReachabilityListener(qc: QueryClient): void {
  qc.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success') {
      setErgoStatus({ reachable: true })
    }
  })
}

export function _resetErgoStatusForTest(): void {
  status = INITIAL
  listeners.clear()
}
