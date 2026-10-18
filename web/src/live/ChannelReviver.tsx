import { useEffect } from 'react'
import { useLiveSession } from './LiveSessionContext'
import { useErgoStatus } from '../offline/ergoStatus'

/**
 * Revives the SSE channel once the ergo is reachable again.
 *
 * EventSourceChannel stops retrying after PERMANENT_FAILURE_AFTER
 * consecutive failures — away from home it burns that budget within a
 * minute and stays dead. Recovery is owned by the reachability probe
 * (ADR-0020): whenever the probe reports reachable while the channel
 * has given up, trigger one reconnect. The status guard means a
 * healthy or still-retrying channel is never torn down, and a
 * backend that accepts /api/health but fails the stream just retries
 * on the probe cadence instead of looping hot.
 */
export function ChannelReviver() {
  const { status, reconnect } = useLiveSession()
  const { reachable } = useErgoStatus()

  useEffect(() => {
    if (reachable === true && status === 'permanently_disconnected') reconnect?.()
  }, [reachable, status, reconnect])

  return null
}
