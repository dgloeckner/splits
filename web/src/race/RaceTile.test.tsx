import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RaceTile } from './RaceTile'
import type { RaceOpponent } from '../api/race'

const ghost: RaceOpponent = {
  sourceSessionId: 's-ghost',
  label: 'ghost',
  tSec: [0, 5, 10, 15, 20],
  split: [120, 120, 120, 120, 120],
}
const pb: RaceOpponent = {
  sourceSessionId: 's-pb',
  label: 'pb',
  tSec: [0, 5, 10, 15, 20],
  split: [110, 110, 110, 110, 110],
}

describe('RaceTile', () => {
  it('renders 3 lanes when both ghost and pb present, in order pb→user→ghost', () => {
    const { container } = render(
      <RaceTile
        elapsedSec={5}
        userDistanceM={20}
        ghost={ghost}
        pb={pb}
        paneWidthPx={400}
        laneHeightPx={32}
      />,
    )
    const lanes = container.querySelectorAll('[data-lane]')
    expect(lanes).toHaveLength(3)
    expect(lanes[0].getAttribute('data-lane')).toBe('pb')
    expect(lanes[1].getAttribute('data-lane')).toBe('user')
    expect(lanes[2].getAttribute('data-lane')).toBe('ghost')
  })

  it('renders 2 lanes when only ghost is present, in order user→ghost', () => {
    const { container } = render(
      <RaceTile
        elapsedSec={5}
        userDistanceM={20}
        ghost={ghost}
        pb={null}
        paneWidthPx={400}
        laneHeightPx={32}
      />,
    )
    const lanes = container.querySelectorAll('[data-lane]')
    expect(lanes).toHaveLength(2)
    expect(lanes[0].getAttribute('data-lane')).toBe('user')
    expect(lanes[1].getAttribute('data-lane')).toBe('ghost')
  })

  it('renders 2 lanes when only pb is present, in order pb→user', () => {
    const { container } = render(
      <RaceTile
        elapsedSec={5}
        userDistanceM={20}
        ghost={null}
        pb={pb}
        paneWidthPx={400}
        laneHeightPx={32}
      />,
    )
    const lanes = container.querySelectorAll('[data-lane]')
    expect(lanes).toHaveLength(2)
    expect(lanes[0].getAttribute('data-lane')).toBe('pb')
    expect(lanes[1].getAttribute('data-lane')).toBe('user')
  })

  it('renders 1 lane (user) when no opponents present', () => {
    const { container } = render(
      <RaceTile
        elapsedSec={5}
        userDistanceM={20}
        ghost={null}
        pb={null}
        paneWidthPx={400}
        laneHeightPx={32}
      />,
    )
    const lanes = container.querySelectorAll('[data-lane]')
    expect(lanes).toHaveLength(1)
    expect(lanes[0].getAttribute('data-lane')).toBe('user')
  })

  it('shows off-screen chip with meters when user is far behind opponent', () => {
    const { getByTestId } = render(
      <RaceTile
        elapsedSec={20}
        userDistanceM={0}
        ghost={ghost}
        pb={null}
        paneWidthPx={200}
        laneHeightPx={32}
      />,
    )
    const chip = getByTestId('chip-ghost')
    expect(chip.textContent ?? '').toMatch(/\+\d+m/)
  })

  it('shows off-screen chip with seconds when offset < 5m and pane is tiny', () => {
    // Ghost at elapsed=20, all splits 120 → distance ≈ 500/120 * 20 ≈ 83.33m
    // Set userDistanceM so offset is small (< 5m)
    const ghostDist = (500 / 120) * 20
    const { getByTestId } = render(
      <RaceTile
        elapsedSec={20}
        userDistanceM={ghostDist - 3} // 3m gap
        ghost={ghost}
        pb={null}
        paneWidthPx={20} // tiny: half = 10, sprite half = 12, so anything > -2px is off
        laneHeightPx={32}
      />,
    )
    const chip = getByTestId('chip-ghost')
    expect(chip.textContent ?? '').toMatch(/[+-][\d.]+s/)
  })

  it('renders hull-only variant when 20 <= laneHeightPx < 28 (no head circle)', () => {
    const { container } = render(
      <RaceTile
        elapsedSec={5}
        userDistanceM={20}
        ghost={ghost}
        pb={pb}
        paneWidthPx={400}
        laneHeightPx={24}
      />,
    )
    expect(container.querySelectorAll('circle')).toHaveLength(0)
  })

  it('returns null when laneHeightPx < 20', () => {
    const { container } = render(
      <RaceTile
        elapsedSec={5}
        userDistanceM={20}
        ghost={ghost}
        pb={pb}
        paneWidthPx={400}
        laneHeightPx={18}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
