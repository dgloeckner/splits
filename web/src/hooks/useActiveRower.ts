import { useQuery } from '@tanstack/react-query'
import { getActiveRower, type Rower } from '../api/rowers'
import { mirrorInitialData } from '../offline/bootstrapMirror'

export function useActiveRower() {
  return useQuery<Rower | null>({
    queryKey: ['active-rower'],
    queryFn: getActiveRower,
    staleTime: 10_000,
    // Local-first boot (ADR-0021), see useRowers.
    ...mirrorInitialData('active'),
  })
}
