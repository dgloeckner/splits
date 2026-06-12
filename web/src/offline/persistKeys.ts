export function isPersistableQuery(queryKey: readonly unknown[]): boolean {
  const [k0, k1, k2] = queryKey
  switch (queryKey.length) {
    case 1:
      return k0 === 'rowers' || k0 === 'active-rower'
    case 2: {
      if (typeof k1 !== 'string' || k1 === '') return false
      if (k0 === 'sessions') return k1 !== 'stale-open'
      return (
        k0 === 'favorites' ||
        k0 === 'rower-pbs' ||
        k0 === 'rower-achievements' ||
        k0 === 'rower-lifetime' ||
        k0 === 'workout'
      )
    }
    case 3: {
      if (typeof k1 !== 'string' || k1 === '') return false
      if (k0 === 'rower-trends') return k2 === '30d' || k2 === '365d' || k2 === 'all'
      if (k0 === 'sessions' && k1 !== 'stale-open') return k2 === 'samples' || k2 === 'pb-banners'
      return false
    }
    default:
      return false
  }
}
