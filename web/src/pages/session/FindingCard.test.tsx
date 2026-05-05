import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FindingCard } from './FindingCard'

describe('FindingCard', () => {
  it('renders message and severity-styled wrapper', () => {
    render(<FindingCard finding={{
      detector_id: 'fade',
      code: 'FADE',
      severity: 'ATTENTION',
      category: 'EFFICIENCY',
      message_de: 'Leistungsabfall von 6,8% im Schlussabschnitt.',
      evidence: {},
    }} />)
    expect(screen.getByText(/Leistungsabfall von 6,8/)).toBeInTheDocument()
    const card = screen.getByTestId('finding-card')
    expect(card.dataset.severity).toBe('ATTENTION')
    expect(card.dataset.category).toBe('EFFICIENCY')
  })
})
