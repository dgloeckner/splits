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
