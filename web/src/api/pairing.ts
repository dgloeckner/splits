import { ApiError } from './error'

export type PairingMint = {
  token: string
  url: string
  qr_svg: string
  expires_at: string
}

export async function mintPairing(rowerID: string): Promise<PairingMint> {
  const r = await fetch(`/api/v1/rowers/${encodeURIComponent(rowerID)}/pairing-tokens`, {
    method: 'POST',
  })
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`)
  return (await r.json()) as PairingMint
}

export async function pair(token: string): Promise<void> {
  const r = await fetch('/api/v1/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`)
}
