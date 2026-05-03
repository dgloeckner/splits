import { useQuery } from '@tanstack/react-query'

export type DeviceStatus = {
  connected: boolean
  port?: string
  last_error?: string
  last_seen_at?: string
}

async function fetchDeviceStatus(): Promise<DeviceStatus> {
  const r = await fetch('/api/v1/device')
  if (!r.ok) throw new Error(`device status: ${r.status}`)
  return (await r.json()) as DeviceStatus
}

/**
 * Polls /api/v1/device every 5 s for IPM serial connectivity. The
 * backend's reconnecting SerialProducer keeps probing the FTDI port;
 * this hook surfaces that state to the UI banner.
 *
 * Returns `{ connected: true }` (i.e. assume OK) until the first poll
 * resolves, so the UI doesn't flash a yellow banner during initial
 * load.
 */
export function useDeviceStatus(): DeviceStatus {
  const q = useQuery({
    queryKey: ['device-status'],
    queryFn: fetchDeviceStatus,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
  })
  return q.data ?? { connected: true }
}
