import type { LiveState, SparklinePoint } from '../live/reducer'
import type { SparklineMetric } from '../live/sparklineAxis'
import { fmtFloat, fmtInt, fmtMeters, mmssWhole, pace500m } from '../util/format'

export type NumericValue = { value: string; unit?: string }
export type SparklineValue = { points: SparklinePoint[] }
export type ZoneValue = { zone: string | null; prompt?: string }

export function selectNumeric(state: LiveState, tileId: string): NumericValue {
  const s = state.stroke
  const sm = state.smoothed
  switch (tileId) {
    case 'zeit':
      return { value: mmssWhole(s?.time_sec ?? null) }
    case 'distanz':
      return { value: fmtMeters(s?.distance_m ?? null), unit: 'm' }
    case 'split': {
      const v = sm?.paceSecPer500m ?? s?.pace_sec_per_500m ?? null
      return { value: pace500m(v) }
    }
    case 'dps': {
      // Derive DPS from smoothed split+SPM for consistency with hero values.
      // Backend-supplied p.dps can diverge because it uses a different
      // stroke-interval averaging window.
      const split = sm?.paceSecPer500m ?? s?.pace_sec_per_500m ?? null
      const spm = sm?.spm ?? s?.spm ?? null
      const v =
        split && spm && split > 0 && spm > 0
          ? 30000 / (split * spm)
          : (sm?.dps ?? s?.dps ?? null)
      return { value: fmtFloat(v, 1), unit: 'm' }
    }
    case 'spi': {
      if (sm?.spi !== undefined && sm.spi !== null) {
        return { value: fmtFloat(sm.spi, 1) }
      }
      if (!s || s.spm === 0 || s.power_w < 20) return { value: '—' }
      return { value: fmtFloat(s.power_w / s.spm, 1) }
    }
    case 'spm': {
      const v = sm?.spm ?? s?.spm ?? null
      return { value: fmtInt(v) }
    }
    case 'schlaege':
      return { value: fmtInt(s?.stroke ?? null) }
    case 'watt': {
      const v = sm?.power ?? s?.power_w ?? null
      return { value: fmtInt(v), unit: 'W' }
    }
    case 'oe-split': {
      const summaryAvg = state.summary?.avg_pace_sec_per_500m ?? null
      if (summaryAvg != null) return { value: pace500m(summaryAvg) }
      // Running avg during live session: time_sec / (distance_m / 500).
      const t = s?.time_sec ?? null
      const d = s?.distance_m ?? null
      if (t != null && d != null && d > 0) {
        return { value: pace500m((t * 500) / d) }
      }
      return { value: pace500m(null) }
    }
    case 'kalorien':
      return { value: fmtInt(s?.cal_per_hr ?? null), unit: 'kcal/h' }
    case 'herzfrequenz':
      return { value: '—', unit: 'bpm' }
    default:
      return { value: '—' }
  }
}

export function selectSparkline(state: LiveState, tileId: string): SparklineValue {
  switch (tileId) {
    case 'watt-verlauf':
      return { points: state.sparklines.power }
    case 'split-verlauf':
      return { points: state.sparklines.split }
    case 'dps-verlauf':
      return { points: state.sparklines.dps }
    case 'spm-verlauf':
      return { points: state.sparklines.spm }
    case 'hf-verlauf':
      return { points: [] }
    default:
      return { points: [] }
  }
}

export function sparklineMetric(tileId: string): SparklineMetric | null {
  switch (tileId) {
    case 'watt-verlauf':
      return 'watts'
    case 'split-verlauf':
      return 'split'
    case 'dps-verlauf':
      return 'dps'
    case 'spm-verlauf':
      return 'spm'
    case 'hf-verlauf':
      return 'hf'
    default:
      return null
  }
}

export function selectZone(_state: LiveState, tileId: string): ZoneValue {
  switch (tileId) {
    case 'hf-zone':
      return { zone: null }
    default:
      return { zone: null }
  }
}
