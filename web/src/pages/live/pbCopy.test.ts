import { describe, expect, it } from 'vitest'
import {
  pbTitleDistance,
  pbTitleWindow,
  pbDeltaText,
  pbHeroValue,
  pbIcon,
} from './pbCopy'
import type { DistancePB, WindowPB } from '../../api/client'

const dpb: DistancePB = {
  distance_m: 500,
  time_sec: 98,
  previous_time_sec: 102,
  source_session_id: 'S1',
  source_session_started_at: '',
  achieved_at: '2026-05-01T18:42:00Z',
}

const wpb: WindowPB = {
  metric: 'power',
  window_kind: 'seconds',
  window_size: 60,
  value: 286,
  previous_value: 268,
  source_session_id: 'S1',
  source_session_started_at: '',
  achieved_at: '2026-05-01T18:42:00Z',
}

describe('pbCopy', () => {
  it('formats distance PB title', () => {
    expect(pbTitleDistance({ ...dpb, distance_m: 500 })).toBe('Neue 500m-Bestzeit!')
    expect(pbTitleDistance({ ...dpb, distance_m: 10000 })).toBe('Neue 10 km-Bestzeit!')
  })
  it('formats window PB title', () => {
    expect(pbTitleWindow(wpb)).toBe('Neue Wattbestzeit!')
    expect(pbTitleWindow({ ...wpb, metric: 'pace' })).toBe('Neue Pace-Bestzeit!')
  })
  it('formats hero value for split (distance PB time)', () => {
    expect(pbHeroValue('distance', dpb)).toBe('1:38')
  })
  it('formats hero value for distance PB long format', () => {
    expect(pbHeroValue('distance', { ...dpb, distance_m: 10000, time_sec: 2533 })).toBe('00:42:13')
  })
  it('formats hero value for power window PB', () => {
    expect(pbHeroValue('window', wpb)).toBe('286 W')
  })
  it('renders delta line for distance PB', () => {
    expect(pbDeltaText('distance', dpb)).toBe('vorher 1:42 — schneller um 4 s')
  })
  it('renders delta for power PB', () => {
    expect(pbDeltaText('window', wpb)).toBe('vorher 268 W — +18 W')
  })
  it('renders empty delta when no previous value', () => {
    expect(pbDeltaText('distance', { ...dpb, previous_time_sec: undefined })).toBe('')
  })
  it('returns icon name per kind', () => {
    expect(pbIcon('distance')).toBe('medal')
    expect(pbIcon('window', 'power')).toBe('lightning')
    expect(pbIcon('window', 'pace')).toBe('stopwatch')
  })
})
