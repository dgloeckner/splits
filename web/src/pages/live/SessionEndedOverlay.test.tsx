import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionEndedOverlay } from './SessionEndedOverlay'
import type { SessionEndSummary } from '../../live/events'

const baseSummary: SessionEndSummary = {
  total_distance_m: 5005,
  total_time_sec: 1122,
  total_strokes: 478,
  avg_power_w: 375,
  peak_power_w: 480,
  avg_spm: 26,
  avg_dps: 9.6,
  avg_pace_sec_per_500m: 109,
  session_calories: 350,
}

describe('SessionEndedOverlay — U4 (post-session CTA)', () => {
  it('makes "Details ansehen" the primary action when a session id is available', () => {
    const onAcknowledge = vi.fn()
    const onShowDetails = vi.fn()
    render(
      <SessionEndedOverlay
        summary={baseSummary}
        banners={{ kind: 'no-banners' }}
        onAcknowledge={onAcknowledge}
        onShowDetails={onShowDetails}
      />,
    )
    const details = screen.getByTestId('session-ended-details')
    const fertig = screen.getByTestId('session-ended-ok')
    expect(details).toHaveTextContent('Details ansehen')
    expect(fertig).toHaveTextContent('Fertig')
    // The old "Neue Session starten" wording is gone — it was the
    // mis-prioritised default that prompted U4.
    expect(screen.queryByText(/neue session starten/i)).toBeNull()
    expect(screen.queryByText(/bereit für eine neue runde/i)).toBeNull()
  })

  it('fires onShowDetails when the primary is clicked', async () => {
    const onShowDetails = vi.fn()
    render(
      <SessionEndedOverlay
        summary={baseSummary}
        banners={{ kind: 'no-banners' }}
        onAcknowledge={vi.fn()}
        onShowDetails={onShowDetails}
      />,
    )
    await userEvent.click(screen.getByTestId('session-ended-details'))
    expect(onShowDetails).toHaveBeenCalledTimes(1)
  })

  it('without onShowDetails, primary becomes the close action labelled "Fertig"', () => {
    const onAcknowledge = vi.fn()
    render(
      <SessionEndedOverlay
        summary={baseSummary}
        banners={{ kind: 'no-banners' }}
        onAcknowledge={onAcknowledge}
      />,
    )
    const primary = screen.getByTestId('session-ended-ok')
    expect(primary).toHaveTextContent('Fertig')
    expect(screen.queryByTestId('session-ended-details')).toBeNull()
  })

  it('shows the PB-computing subtitle only while banners are resolving', () => {
    const { rerender } = render(
      <SessionEndedOverlay
        summary={baseSummary}
        banners={{ kind: 'computing' }}
        onAcknowledge={vi.fn()}
        onShowDetails={vi.fn()}
      />,
    )
    expect(screen.getByText(/Bestleistungen werden berechnet/)).toBeInTheDocument()
    rerender(
      <SessionEndedOverlay
        summary={baseSummary}
        banners={{ kind: 'no-banners' }}
        onAcknowledge={vi.fn()}
        onShowDetails={vi.fn()}
      />,
    )
    expect(screen.queryByText(/Bestleistungen werden berechnet/)).toBeNull()
  })
})
