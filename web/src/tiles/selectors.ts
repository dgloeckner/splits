import type { LiveState, SparklinePoint } from '../live/reducer'
import { fmtFloat, fmtInt, fmtMeters, mmss, pace500m } from '../util/format'

export type NumericValue = { value: string; unit?: string }
export type SparklineValue = { points: SparklinePoint[] }
export type ZoneValue = { zone: string | null; prompt?: string }

export function selectNumeric(state: LiveState, tileId: string): NumericValue {
  const s = state.stroke
  const sm = state.smoothed
  switch (tileId) {
    case 'zeit':
      return { value: mmss(s?.time_sec ?? null) }
    case 'distanz':
      return { value: fmtMeters(s?.distance_m ?? null), unit: 'm' }
    case 'split': {
      const v = sm?.paceSecPer500m ?? s?.pace_sec_per_500m ?? null
      return { value: pace500m(v), unit: '/ 500m' }
    }
    case 'dps': {
      const v = sm?.dps ?? s?.dps ?? null
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
    case 'watt': {
      const v = sm?.power ?? s?.power_w ?? null
      return { value: fmtInt(v), unit: 'W' }
    }
    case 'oe-split':
      return { value: pace500m(state.summary?.avg_pace_sec_per_500m ?? null), unit: '/ 500m' }
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
    case 'hf-verlauf':
      return { points: [] }
    default:
      return { points: [] }
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
