import { apiFetch } from './error'

export type Severity = 'INFO' | 'NOTABLE' | 'ATTENTION'
export type Category = 'PACING' | 'EFFICIENCY' | 'CONSISTENCY'
export type FindingCode =
  | 'POSITIVE_SPLIT' | 'NEGATIVE_SPLIT' | 'EVEN_SPLIT'
  | 'FADE'
  | 'CONSISTENT_HIGH' | 'CONSISTENT_MID' | 'INCONSISTENT'
  | 'EFFICIENCY_DRIFT'

export type Finding = {
  detector_id: string
  code: FindingCode
  severity: Severity
  category: Category
  message_de: string
  evidence: Record<string, number>
}

export type InsightsReason = 'intervals' | 'too_short' | undefined

export type Insights = {
  findings: Finding[]
  synthesisDe: string
  reason?: InsightsReason
}

type WireInsights = {
  findings: Finding[]
  synthesis_de: string
  reason?: InsightsReason
}

export async function getSessionInsights(sessionId: string): Promise<Insights> {
  const r = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/insights`)
  if (!r.ok) throw new Error(`insights fetch failed: ${r.status}`)
  const w = (await r.json()) as WireInsights
  return {
    findings: w.findings ?? [],
    synthesisDe: w.synthesis_de ?? '',
    reason: w.reason,
  }
}
