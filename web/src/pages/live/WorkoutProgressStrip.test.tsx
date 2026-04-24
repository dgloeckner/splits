import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Segment, ActiveSegment } from '../../live/segments'
import { WorkoutProgressStripView } from './WorkoutProgressStrip'

function seg(kind: Segment['kind'], index: number, d?: number, s?: number): Segment {
  return {
    kind, index,
    distanceM: d, durationSec: s,
    startTimeSec: 0, endTimeSec: 0, startDistanceM: 0, endDistanceM: 0,
  }
}

describe('WorkoutProgressStripView', () => {
  it('renders nothing when segments are empty', () => {
    const { container } = render(<WorkoutProgressStripView segments={[]} active={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one block per segment', () => {
    const segs = [
      seg('warmup', 0, undefined, 120),
      seg('work', 1, 500),
      seg('rest', 2, undefined, 60),
      seg('work', 3, 500),
      seg('cooldown', 4, undefined, 120),
    ]
    render(<WorkoutProgressStripView segments={segs} active={null} />)
    const strip = screen.getByTestId('progress-strip')
    expect(strip.children.length).toBe(5)
  })

  it('renders active marker for the active segment', () => {
    const segs = [seg('warmup', 0, undefined, 120), seg('work', 1, 500)]
    const active: ActiveSegment = {
      segment: segs[1],
      remainingM: 250,
      progressRatio: 0.5,
      totalSegments: 2,
      activeIndexOneBased: 2,
    }
    render(<WorkoutProgressStripView segments={segs} active={active} />)
    const marker = screen.getByTestId('progress-marker')
    expect(marker).toBeInTheDocument()
    expect((marker as HTMLElement).style.left).toBe('50%')
  })

  it('no marker when active is null', () => {
    const segs = [seg('work', 0, 500)]
    render(<WorkoutProgressStripView segments={segs} active={null} />)
    expect(screen.queryByTestId('progress-marker')).toBeNull()
  })
})
