import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RacePostScreen } from './RacePostScreen'

const userSeries = { tSec: [0, 60, 120, 180, 240], split: [120, 118, 116, 114, 112] }
const ghost = {
  kind: 'session' as const,
  sourceSessionId: 'g',
  label: 'ghost' as const,
  tSec: [0, 60, 120, 180, 240],
  split: [120, 120, 120, 120, 120],
}

describe('RacePostScreen', () => {
  it('shows final time, ghost gap, and chart', () => {
    render(
      <RacePostScreen
        totalMeters={1000}
        userTotalSec={240}
        userTSec={userSeries.tSec}
        userSplit={userSeries.split}
        ghost={ghost}
        pb={null}
        vsGhostSec={-4.2}
        vsPbSec={null}
        onRetry={() => {}}
        onShowDetail={() => {}}
      />,
    )
    expect(screen.getByText(/4:00/)).toBeTruthy()
    expect(screen.getByText(/-4\.2/)).toBeTruthy()
    expect(screen.getByText(/Erneut rennen/)).toBeTruthy()
    expect(screen.getByText(/Detail/)).toBeTruthy()
    expect(screen.queryByText(/vs\. PB/)).toBeNull()
  })

  it('shows both gaps when both opponents present', () => {
    render(
      <RacePostScreen
        totalMeters={2000}
        userTotalSec={480}
        userTSec={userSeries.tSec}
        userSplit={userSeries.split}
        ghost={ghost}
        pb={{ ...ghost, sourceSessionId: 'p', label: 'pb', split: [110, 110, 110, 110, 110] }}
        vsGhostSec={2.1}
        vsPbSec={-3.4}
        onRetry={() => {}}
        onShowDetail={() => {}}
      />,
    )
    expect(screen.getByText(/vs\. PB/)).toBeTruthy()
    expect(screen.getByText(/-3\.4/)).toBeTruthy()
    expect(screen.getByText(/vs\. Ghost/)).toBeTruthy()
    expect(screen.getByText(/\+2\.1/)).toBeTruthy()
  })

  it('invokes callbacks on button click', () => {
    const onRetry = vi.fn()
    const onShowDetail = vi.fn()
    render(
      <RacePostScreen
        totalMeters={500}
        userTotalSec={120}
        userTSec={[0]}
        userSplit={[120]}
        ghost={null}
        pb={null}
        vsGhostSec={null}
        vsPbSec={null}
        onRetry={onRetry}
        onShowDetail={onShowDetail}
      />,
    )
    screen.getByText(/Erneut rennen/).click()
    screen.getByText(/Detail/).click()
    expect(onRetry).toHaveBeenCalled()
    expect(onShowDetail).toHaveBeenCalled()
  })
})
