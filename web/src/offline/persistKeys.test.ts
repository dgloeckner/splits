import { describe, it, expect } from 'vitest'
import { isPersistableQuery } from './persistKeys'

describe('isPersistableQuery', () => {
  it.each<[readonly unknown[]]>([
    [['rowers']],
    [['active-rower']],
    [['favorites', 'R1']],
    [['rower-pbs', 'R1']],
    [['rower-achievements', 'R1']],
    [['rower-lifetime', 'R1']],
    [['rower-trends', 'R1', '30d']],
    [['rower-trends', 'R1', '365d']],
    [['rower-trends', 'R1', 'all']],
    [['sessions', 'S1']],
    [['sessions', 'S1', 'samples']],
    [['sessions', 'S1', 'pb-banners']],
    [['workout', 'W1']],
  ])('persists %j', (key) => {
    expect(isPersistableQuery(key)).toBe(true)
  })

  it.each<[readonly unknown[]]>([
    [['sessions', 'stale-open', 'R1']],
    [['active-session']],
    [['race-opponents', 'W1', 'R1']],
    [['favorites', '']],
    [['workout', null]],
    [['rower-trends', 'R1', 'week']],
    [['sessions', 'S1', 'extras']],
    [['pair-token']],
    [[]],
  ])('does not persist %j', (key) => {
    expect(isPersistableQuery(key)).toBe(false)
  })
})
