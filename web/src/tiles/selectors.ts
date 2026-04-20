import type { LiveState, SparklinePoint } from '../live/reducer'
import { fmtFloat, fmtInt, fmtMeters, mmss, pace500m } from '../util/format'

export type NumericValue = { value: string; unit?: string }
export type SparklineValue = { points: SparklinePoint[] }
export type ZoneValue = { zone: string | null; prompt?: string }

export function selectNumeric(state: LiveState, tileId: string): NumericValue {
  const s = state.stroke
  switch (tileId) {
    case 'zeit':
      return { value: mmss(s?.time_sec ?? null) }
    case 'distanz':
      return { value: fmtMeters(s?.distance_m ?? null), unit: 'm' }
    case 'split':
      return { value: pace500m(s?.pace_sec_per_500m ?? null), unit: '/ 500m' }
    case 'dps':
      return { value: fmtFloat(s?.dps ?? null, 1), unit: 'm' }
    case 'spi': {
      if (!s || s.spm === 0 || s.power_w < 20) return { value: '—' }
      return { value: fmtFloat(s.power_w / s.spm, 1) }
    }
    case 'spm':
      return { value: fmtInt(s?.spm ?? null) }
    case 'watt':
      return { value: fmtInt(s?.power_w ?? null), unit: 'W' }
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
