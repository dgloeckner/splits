import { getFetch, readApiError } from './error'

/** The five states of ADR-0023 §4, named by the updater on the Pi. */
export type UpdateState = 'current' | 'behind' | 'stuck' | 'unknown' | 'off'

/** GET /api/v1/update-status — the unattended updater's last verdict. */
export type UpdateStatus = {
  available: boolean
  state: UpdateState
  /** Version of the backend answering this request. */
  running: string
  installed?: string
  previous?: string
  latest?: string
  checked_at?: string
  result?: string
  message?: string
  blocked: string[]
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const r = await getFetch('/api/v1/update-status')
  if (!r.ok) throw await readApiError(r)
  return (await r.json()) as UpdateStatus
}
