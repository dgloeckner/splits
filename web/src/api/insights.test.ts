import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSessionInsights } from './insights'

describe('insights api', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parses findings + synthesis', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      findings: [{
        detector_id: 'pacing', code: 'POSITIVE_SPLIT',
        severity: 'NOTABLE', category: 'PACING',
        message_de: 'Positiver Split.', evidence: { delta: 3.6 },
      }],
      synthesis_de: 'Positiver Split.',
    }), { status: 200 }))
    const r = await getSessionInsights('s1')
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].code).toBe('POSITIVE_SPLIT')
    expect(r.synthesisDe).toBe('Positiver Split.')
  })

  it('returns reason when ineligible', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      findings: [], synthesis_de: '', reason: 'intervals',
    }), { status: 200 }))
    const r = await getSessionInsights('s1')
    expect(r.findings).toHaveLength(0)
    expect(r.reason).toBe('intervals')
  })
})
