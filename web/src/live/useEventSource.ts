import { useEffect, useReducer } from 'react'
import type { Channel } from './channel'
import { liveReducer, initialLiveState, type LiveState } from './reducer'

export function useEventSource(channel: Channel): LiveState {
  const [state, dispatch] = useReducer(liveReducer, initialLiveState)

  useEffect(() => {
    channel.subscribe({
      onEvent: (event) => dispatch({ type: 'event', event }),
      onStatus: (status) => dispatch({ type: 'status', status }),
    })
    return () => channel.close()
  }, [channel])

  return state
}
