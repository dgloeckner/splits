import { useQuery } from '@tanstack/react-query'
import { listRowers, type Rower } from '../api/rowers'

export function useRowers() {
  return useQuery<Rower[]>({
    queryKey: ['rowers'],
    queryFn: listRowers,
    staleTime: 30_000,
  })
}
