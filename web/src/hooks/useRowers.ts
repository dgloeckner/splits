import { useQuery } from '@tanstack/react-query'
import { listRowers, type Rower } from '../api/rowers'
import { mirrorInitialData } from '../offline/bootstrapMirror'

export function useRowers() {
  return useQuery<Rower[]>({
    queryKey: ['rowers'],
    queryFn: listRowers,
    staleTime: 30_000,
    // Local-first boot (ADR-0021): render from the durable mirror, then
    // revalidate at once (savedAt is in the past, so it is stale).
    ...mirrorInitialData('rowers'),
  })
}
