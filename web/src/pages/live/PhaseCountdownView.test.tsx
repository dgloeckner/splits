import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
