import { useQuery } from '@tanstack/react-query'
import { getActiveRower, type Rower } from '../api/rowers'

export function useActiveRower() {
  return useQuery<Rower | null>({
    queryKey: ['active-rower'],
    queryFn: getActiveRower,
    staleTime: 10_000,
    retry: true,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  })
}
