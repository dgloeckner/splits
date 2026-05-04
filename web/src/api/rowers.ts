export type Rower = {
  id: string
  name: string
  weight_kg?: number
  height_cm?: number
  dob?: string
  color: string
  created_at: string
}

export type CreateRowerInput = {
  name: string
  weight_kg?: number
  height_cm?: number
  dob?: string
  color?: string
}

export type UpdateRowerInput = Partial<CreateRowerInput>

export { ApiError } from './error'
import { apiFetch, readApiError } from './error'

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw await readApiError(r)
  return (await r.json()) as T
}

export async function listRowers(): Promise<Rower[]> {
  const r = await apiFetch('/api/v1/rowers')
  const body = await json<{ rowers: Rower[] }>(r)
  return body.rowers
}

export async function createRower(input: CreateRowerInput): Promise<Rower> {
  const r = await apiFetch('/api/v1/rowers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return json<Rower>(r)
}

export async function updateRower(id: string, input: UpdateRowerInput): Promise<Rower> {
  const r = await apiFetch(`/api/v1/rowers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return json<Rower>(r)
}

export async function getActiveRower(): Promise<Rower | null> {
  const r = await apiFetch('/api/v1/active-rower')
  if (r.status === 404) return null
  return json<Rower>(r)
}

export async function setActiveRower(rowerId: string): Promise<Rower> {
  const r = await apiFetch('/api/v1/active-rower', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rower_id: rowerId }),
  })
  return json<Rower>(r)
}
