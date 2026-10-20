import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FindingCard } from './FindingCard'

const fade = {
  detector_id: 'fade',
  code: 'FADE' as const,
  severity: 'ATTENTION' as const,
  category: 'EFFICIENCY' as const,
  message_de: 'Leistungsabfall von 6,8% im Schlussabschnitt (200W Schnitt → 186W).',
  evidence: { pct: 6.8, avg: 200, final: 186 },
}

describe('FindingCard', () => {
  it('shows label and key number, not the sentence', () => {
    render(<FindingCard finding={fade} />)
    expect(screen.getByText('Leistung')).toBeInTheDocument()
    expect(screen.getByTestId('finding-headline')).toHaveTextContent('−6,8%')
    expect(screen.queryByText(/Schlussabschnitt/)).not.toBeInTheDocument()
    const card = screen.getByTestId('finding-card')
    expect(card.dataset.severity).toBe('ATTENTION')
    expect(card.dataset.category).toBe('EFFICIENCY')
  })

  it('draws a sparkline when samples are loaded', () => {
    const samples = {
      samples: Array.from({ length: 10 }, (_, i) => ({
        stroke_no: i + 1, time_sec: i * 10, distance_m: 0, spm: 28, power_w: 200 - i, cal_per_hr: 0,
        level: 0, dps: 9, stroke_cycle_sec: 0, pace_sec_per_500m: 110, energy_joules: 0,
      })),
      window: null,
    }
    render(<FindingCard finding={fade} samples={samples} />)
    expect(screen.getByTestId('finding-sparkline')).toBeInTheDocument()
  })
})
