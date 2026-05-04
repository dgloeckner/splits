import { useQuery } from '@tanstack/react-query'
import { listRowers, type Rower } from '../api/rowers'

export function useRowers() {
  return useQuery<Rower[]>({
    queryKey: ['rowers'],
    queryFn: listRowers,
    staleTime: 30_000,
    retry: true,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  })
}
