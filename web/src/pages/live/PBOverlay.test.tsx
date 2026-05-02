import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PBOverlay } from './PBOverlay'
import type { SessionPBBanners } from '../../api/client'

const onlyDist: SessionPBBanners = {
  distance: [
    {
      distance_m: 500,
      time_sec: 98,
      previous_time_sec: 102,
      source_session_id: 'S1',
      source_session_started_at: '',
      achieved_at: '2026-05-01T18:42:00Z',
    },
  ],
  window: [],
}

const stack: SessionPBBanners = {
  distance: [onlyDist.distance[0]],
  window: [
    {
      metric: 'power',
      window_kind: 'seconds',
      window_size: 60,
      value: 286,
      previous_value: 268,
      source_session_id: 'S1',
      source_session_started_at: '',
      achieved_at: '2026-05-01T18:42:00Z',
    },
    {
      metric: 'pace',
      window_kind: 'seconds',
      window_size: 60,
      value: 110,
      previous_value: 115,
      source_session_id: 'S1',
      source_session_started_at: '',
      achieved_at: '2026-05-01T18:42:00Z',
    },
  ],
}

describe('PBOverlay', () => {
  it('renders single-PB hero', () => {
    render(<PBOverlay banners={onlyDist} onDismiss={() => {}} onShowInRekorde={() => {}} />)
    expect(screen.getByText('Neue 500m-Bestzeit!')).toBeTruthy()
    expect(screen.queryByTestId('pb-stack-dots')).toBeNull()
  })

  it('renders stack with dot indicator', () => {
    render(<PBOverlay banners={stack} onDismiss={() => {}} onShowInRekorde={() => {}} />)
    const dots = screen.getByTestId('pb-stack-dots').querySelectorAll('span')
    expect(dots.length).toBe(3)
  })

  it('Weiter advances stack until last card; final Weiter dismisses', () => {
    const onDismiss = vi.fn()
    render(<PBOverlay banners={stack} onDismiss={onDismiss} onShowInRekorde={() => {}} />)
    const next = () => fireEvent.click(screen.getByRole('button', { name: /Weiter/i }))
    next()
    next()
    next()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('In Rekorden zeigen invokes callback with current PB', () => {
    const onShow = vi.fn()
    render(<PBOverlay banners={onlyDist} onDismiss={() => {}} onShowInRekorde={onShow} />)
    fireEvent.click(screen.getByRole('button', { name: /In Rekorden zeigen/i }))
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it('shows workout-complete subtitle when label is provided', () => {
    render(
      <PBOverlay
        banners={onlyDist}
        workoutLabel="2× 500m"
        onDismiss={() => {}}
        onShowInRekorde={() => {}}
      />,
    )
    expect(screen.getByText(/Workout abgeschlossen · 2× 500m/)).toBeTruthy()
  })

  it('omits workout-complete subtitle when label not provided', () => {
    render(
      <PBOverlay banners={onlyDist} onDismiss={() => {}} onShowInRekorde={() => {}} />,
    )
    expect(screen.queryByText(/Workout abgeschlossen/)).toBeNull()
  })
})
