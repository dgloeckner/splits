import type { Finding } from '../../api/insights'
import type { Sample, SessionSamples } from '../../api/client'
import { formatMetric } from '../../components/charts/format'
import { decimalComma, fmtFloat } from '../../util/format'

// Evidence layer of a finding card (#40): a key number and a sparkline
// of the slice the finding rests on. The synthesis paragraph is the
// only prose; cards never repeat its sentences.

export type SparkSpec = {
  /** One value per bucket, already cut to the analysis window. */
  series: number[]
  /** Index range [from, to) drawn as a shaded region. */
  shade?: { from: number; to: number }
  /** Horizontal band, e.g. mean ± 1 std. */
  band?: { lo: number; hi: number }
  /** Flat reference lines over index ranges [from, to). */
  levels?: { y: number; from: number; to: number }[]
}

export type FindingVisual = {
  /** Key number, e.g. "Variation 2,0%" or "1:48,3 / 1:47,8". */
  headline: string
  /** One- or two-word reading of the number, e.g. "gleichmäßig". */
  tag: string
  spark: SparkSpec | null
}

/** FadeFinalFraction in backend/internal/insights/fade.go. */
const FADE_FINAL_FRACTION = 0.2

const pct = (v: number) => `${decimalComma(fmtFloat(v, 1))}%` // as in the FEAT-0011 templates
const ev = (f: Finding, k: string): number | null => (Number.isFinite(f.evidence?.[k]) ? f.evidence[k] : null)

/**
 * The window the finding was computed over, as bucket indices into the
 * samples: the finding's own evidence first, then the samples' window,
 * then the full series.
 */
export function findingWindow(f: Finding, s: SessionSamples): { from: number; to: number } {
  const n = s.samples.length
  const from = ev(f, 'window_from') ?? s.window?.from ?? 0
  const to = ev(f, 'window_to') ?? s.window?.to ?? n
  if (from < 0 || to > n || from >= to) return { from: 0, to: n }
  return { from, to }
}

function series(f: Finding, s: SessionSamples | null | undefined, pick: (x: Sample) => number): number[] | null {
  if (!s || s.samples.length === 0) return null
  const { from, to } = findingWindow(f, s)
  const out = s.samples.slice(from, to).map(pick)
  return out.length >= 2 ? out : null
}

const pacingTag: Record<string, string> = {
  EVEN_SPLIT: 'gleichmäßig',
  POSITIVE_SPLIT: 'positiver Split',
  NEGATIVE_SPLIT: 'negativer Split',
}
const consistencyTag: Record<string, string> = {
  CONSISTENT_HIGH: 'sehr gleichmäßig',
  CONSISTENT_MID: 'gleichmäßig',
  INCONSISTENT: 'ungleichmäßig',
}

export function findingVisual(f: Finding, s?: SessionSamples | null): FindingVisual {
  switch (f.code) {
    case 'EVEN_SPLIT':
    case 'POSITIVE_SPLIT':
    case 'NEGATIVE_SPLIT': {
      const h1 = ev(f, 'h1')
      const h2 = ev(f, 'h2')
      const sep = f.code === 'EVEN_SPLIT' ? ' / ' : ' → '
      const ys = series(f, s, (x) => x.pace_sec_per_500m)
      const mid = ys ? Math.floor(ys.length / 2) : 0
      return {
        headline: `${formatMetric.split(h1)}${sep}${formatMetric.split(h2)}`,
        tag: pacingTag[f.code],
        spark: ys && {
          series: ys,
          shade: { from: mid, to: ys.length },
          levels: [
            ...(h1 != null ? [{ y: h1, from: 0, to: mid }] : []),
            ...(h2 != null ? [{ y: h2, from: mid, to: ys.length }] : []),
          ],
        },
      }
    }
    case 'CONSISTENT_HIGH':
    case 'CONSISTENT_MID':
    case 'INCONSISTENT': {
      const cv = ev(f, 'cv')
      const mean = ev(f, 'mean')
      const std = ev(f, 'std')
      const ys = series(f, s, (x) => x.pace_sec_per_500m)
      return {
        headline: cv != null ? `Variation ${pct(cv)}` : '—',
        tag: consistencyTag[f.code],
        spark: ys && {
          series: ys,
          ...(mean != null && std != null ? { band: { lo: mean - std, hi: mean + std } } : {}),
          ...(mean != null ? { levels: [{ y: mean, from: 0, to: ys.length }] } : {}),
        },
      }
    }
    case 'FADE': {
      const p = ev(f, 'pct')
      const avg = ev(f, 'avg')
      const final = ev(f, 'final')
      const ys = series(f, s, (x) => x.power_w)
      const tail = ys ? Math.max(1, Math.floor(ys.length * FADE_FINAL_FRACTION)) : 0
      return {
        headline: p != null ? `−${pct(p)}` : '—',
        tag: avg != null && final != null ? `${Math.round(avg)} → ${Math.round(final)} W` : 'Leistungsabfall',
        spark: ys && {
          series: ys,
          shade: { from: ys.length - tail, to: ys.length },
          levels: [
            ...(avg != null ? [{ y: avg, from: 0, to: ys.length }] : []),
            ...(final != null ? [{ y: final, from: ys.length - tail, to: ys.length }] : []),
          ],
        },
      }
    }
    default:
      return { headline: '—', tag: '', spark: null }
  }
}
