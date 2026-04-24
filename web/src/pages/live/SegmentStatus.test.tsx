import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SegmentStatusView } from './SegmentStatus'
import type { Workout } from '../../api/workouts'
import type { ActiveSegment, Segment } from '../../live/segments'

function seg(kind: Segment['kind'], index: number, d?: number, s?: number): Segment {
  return { kind, index, distanceM: d, durationSec: s, startTimeSec: 0, endTimeSec: 0, startDistanceM: 0, endDistanceM: 0 }
}
function active(overrides: Partial<ActiveSegment> & Pick<ActiveSegment, 'segment'>): ActiveSegment {
  return { remainingSec: 0, remainingM: 0, progressRatio: 0, totalSegments: 1, activeIndexOneBased: 1, ...overrides }
}

const distanceWorkout: Workout = {
  id: 'W', mode: 'distance', params: { meters: 5000 },
  intensity: 'moderat', warmup_sec: 0, cooldown_sec: 0, created_at: '',
}
const timeWorkout: Workout = {
  id: 'W', mode: 'time', params: { seconds: 1800 },
  warmup_sec: 0, cooldown_sec: 0, created_at: '',
}
const intervalsWorkout: Workout = {
  id: 'W', mode: 'intervals',
  params: { reps: 4, length: { unit: 'm', value: 500 }, rest_sec: 60 },
  intensity: 'hart', warmup_sec: 120, cooldown_sec: 0, created_at: '',
}

describe('SegmentStatusView', () => {
  it('renders nothing without active', () => {
    const { container } = render(<SegmentStatusView active={null} workout={distanceWorkout} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders distance remaining for distance workout', () => {
    render(<SegmentStatusView active={active({ segment: seg('work', 0, 5000), remainingM: 2500, activeIndexOneBased: 1 })} workout={distanceWorkout} />)
    expect(screen.getByText('2500 m bis Ziel')).toBeInTheDocument()
  })

  it('renders warmup countdown', () => {
    render(<SegmentStatusView active={active({ segment: seg('warmup', 0, undefined, 120), remainingSec: 45 })} workout={distanceWorkout} />)
    expect(screen.getByText('Warm-up · 45s')).toBeInTheDocument()
  })

  it('renders rest countdown', () => {
    render(<SegmentStatusView active={active({ segment: seg('rest', 2, undefined, 60), remainingSec: 20 })} workout={intervalsWorkout} />)
    expect(screen.getByText('Pause · 20s')).toBeInTheDocument()
  })

  it('intervals work label: Intervall 2 / 4 · 500 m', () => {
    // intervals shape: [warmup, work, rest, work, rest, work, rest, work]
    // indices:         0       1     2     3     4     5     6     7
    // second work is at index 3; activeIndexOneBased = 4
    render(<SegmentStatusView active={active({ segment: seg('work', 3, 500), activeIndexOneBased: 4 })} workout={intervalsWorkout} />)
    expect(screen.getByText('Intervall 2 / 4 · 500 m')).toBeInTheDocument()
  })

  it('urgent styling when remainingSec <= 10', () => {
    render(<SegmentStatusView active={active({ segment: seg('warmup', 0, undefined, 120), remainingSec: 5 })} workout={distanceWorkout} />)
    const banner = screen.getByTestId('segment-status')
    expect(banner.className).toMatch(/urgent/)
  })

  it('time workout countdown', () => {
    render(<SegmentStatusView active={active({ segment: seg('work', 0, undefined, 1800), remainingSec: 600 })} workout={timeWorkout} />)
    expect(screen.getByText('600s bis Ziel')).toBeInTheDocument()
  })
})
