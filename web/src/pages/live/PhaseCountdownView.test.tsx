import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { PhaseCountdownView } from './PhaseCountdownView'

describe('PhaseCountdownView', () => {
  it('renders mm:ss for warmup with German phase label', () => {
    render(<PhaseCountdownView phase="warmup" remainingSec={75} />)
    expect(screen.getByTestId('phase-countdown')).toBeInTheDocument()
    expect(screen.getByTestId('phase-countdown-time')).toHaveTextContent('1:15')
    expect(screen.getByTestId('phase-countdown-label')).toHaveTextContent(/aufwärmen|warmup/i)
  })

  it('renders mm:ss for cooldown with German phase label', () => {
    render(<PhaseCountdownView phase="cooldown" remainingSec={9} />)
    expect(screen.getByTestId('phase-countdown-time')).toHaveTextContent('0:09')
    expect(screen.getByTestId('phase-countdown-label')).toHaveTextContent(/cool[- ]?down|ausrudern/i)
  })

  it('clamps negative remainingSec to 0:00', () => {
    render(<PhaseCountdownView phase="cooldown" remainingSec={-3} />)
    expect(screen.getByTestId('phase-countdown-time')).toHaveTextContent('0:00')
  })

  it('handles a null/undefined remainingSec by rendering --:--', () => {
    render(<PhaseCountdownView phase="warmup" remainingSec={null} />)
    expect(screen.getByTestId('phase-countdown-time')).toHaveTextContent('--:--')
  })

  // U1+U2: the countdown previously only ticked on stroke arrivals,
  // freezing for 2-4 s between strokes. With an anchorMs prop the view
  // extrapolates by wall clock so seconds tick down continuously.
  describe('wall-clock extrapolation between strokes', () => {
    afterEach(() => { vi.useRealTimers() })
    it('ticks down by wall clock between stroke updates when anchorMs is provided', () => {
      vi.useFakeTimers()
      const anchor = 1_700_000_000_000
      vi.setSystemTime(anchor)
      render(<PhaseCountdownView phase="warmup" remainingSec={60} anchorMs={anchor} />)
      expect(screen.getByTestId('phase-countdown-time')).toHaveTextContent('1:00')
      // 3 wall-clock seconds pass without a new stroke / prop update.
      act(() => { vi.setSystemTime(anchor + 3000); vi.advanceTimersByTime(300) })
      // 60 - 3.3 = 56.7 → floor → 0:56
      expect(screen.getByTestId('phase-countdown-time')).toHaveTextContent('0:56')
    })

    it('does not tick past zero', () => {
      vi.useFakeTimers()
      const anchor = 1_700_000_000_000
      vi.setSystemTime(anchor)
      render(<PhaseCountdownView phase="cooldown" remainingSec={2} anchorMs={anchor} />)
      act(() => { vi.setSystemTime(anchor + 10_000); vi.advanceTimersByTime(300) })
      expect(screen.getByTestId('phase-countdown-time')).toHaveTextContent('0:00')
    })

    it('without anchorMs behaves as before (no ticking, shows last remainingSec)', () => {
      vi.useFakeTimers()
      const anchor = 1_700_000_000_000
      vi.setSystemTime(anchor)
      render(<PhaseCountdownView phase="warmup" remainingSec={60} />)
      expect(screen.getByTestId('phase-countdown-time')).toHaveTextContent('1:00')
      act(() => { vi.setSystemTime(anchor + 5000); vi.advanceTimersByTime(1000) })
      expect(screen.getByTestId('phase-countdown-time')).toHaveTextContent('1:00')
    })
  })
})
