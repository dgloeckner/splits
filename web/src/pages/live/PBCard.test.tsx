import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PBCard } from './PBCard'

const dpb = {
  kind: 'distance' as const,
  pb: {
    distance_m: 500,
    time_sec: 98,
    previous_time_sec: 102,
    source_session_id: 'S1',
    source_session_started_at: '',
    achieved_at: '2026-05-01T18:42:00Z',
  },
}

describe('PBCard', () => {
  it('renders title, hero value, delta', () => {
    render(<PBCard {...dpb} />)
    expect(screen.getByText('Neue 500m-Bestzeit!')).toBeTruthy()
    expect(screen.getByText('1:38')).toBeTruthy()
    expect(screen.getByText(/vorher 1:42/)).toBeTruthy()
  })

  it('omits delta line when no previous value', () => {
    render(<PBCard kind="distance" pb={{ ...dpb.pb, previous_time_sec: undefined }} />)
    expect(screen.queryByText(/vorher/)).toBeNull()
  })

  it('shows achievement icon by name', () => {
    render(<PBCard {...dpb} />)
    expect(screen.getByTestId('pb-icon-medal')).toBeTruthy()
  })
})
