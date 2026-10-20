import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InsightsSection } from './InsightsSection'
import * as api from '../../api/insights'

describe('InsightsSection', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('renders synthesis + cards for eligible session', async () => {
    vi.spyOn(api, 'getSessionInsights').mockResolvedValue({
      findings: [
        { detector_id: 'fade', code: 'FADE', severity: 'ATTENTION', category: 'EFFICIENCY', message_de: 'Leistungsabfall.', evidence: {} },
        { detector_id: 'pacing', code: 'POSITIVE_SPLIT', severity: 'NOTABLE', category: 'PACING', message_de: 'Positiver Split.', evidence: {} },
      ],
      synthesisDe: 'Leistungsabfall. — Positiver Split.',
    })
    render(<InsightsSection sessionId="s1" />)
    expect(await screen.findByText(/Leistungsabfall\. — Positiver Split\./)).toBeInTheDocument()
    expect(screen.getAllByTestId('finding-card')).toHaveLength(2)
  })

  it('the synthesis is the only prose: no card repeats it', async () => {
    vi.spyOn(api, 'getSessionInsights').mockResolvedValue({
      findings: [
        { detector_id: 'pacing', code: 'EVEN_SPLIT', severity: 'INFO', category: 'PACING',
          message_de: 'Gleichmäßiges Tempo über beide Hälften (1:48,3 / 1:47,8).', evidence: { h1: 108.3, h2: 107.8 } },
        { detector_id: 'consistency', code: 'CONSISTENT_MID', severity: 'INFO', category: 'CONSISTENCY',
          message_de: 'Tempokonstanz: gleichmäßig (Split-Variation 2,0%).', evidence: { cv: 2, mean: 108, std: 2.2 } },
      ],
      synthesisDe: 'Gleichmäßiges Tempo über beide Hälften (1:48,3 / 1:47,8). Tempokonstanz: gleichmäßig (Split-Variation 2,0%).',
    })
    render(<InsightsSection sessionId="s1" />)
    const synthesis = (await screen.findByTestId('insights-synthesis')).textContent!
    const cards = screen.getAllByTestId('finding-card')
    expect(cards.map((c) => c.dataset.category)).toEqual(['PACING', 'CONSISTENCY'])
    for (const c of cards) {
      expect(synthesis).not.toContain(c.textContent)
      expect(c.textContent).not.toContain('Gleichmäßiges Tempo')
      expect(c.textContent).not.toContain('Split-Variation')
    }
  })

  it('renders intervals placeholder', async () => {
    vi.spyOn(api, 'getSessionInsights').mockResolvedValue({
      findings: [], synthesisDe: '', reason: 'intervals',
    })
    render(<InsightsSection sessionId="s1" />)
    expect(await screen.findByText(/Intervalle in Vorbereitung/)).toBeInTheDocument()
  })

  it('renders too-short placeholder', async () => {
    vi.spyOn(api, 'getSessionInsights').mockResolvedValue({
      findings: [], synthesisDe: '', reason: 'too_short',
    })
    render(<InsightsSection sessionId="s1" />)
    expect(await screen.findByText(/zu kurz/i)).toBeInTheDocument()
  })

  it('hides itself silently on fetch error', async () => {
    vi.spyOn(api, 'getSessionInsights').mockRejectedValue(new Error('boom'))
    const { container } = render(<InsightsSection sessionId="s1" />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
