// Adaptive Y-axis scaling for sparkline tiles.
// See specs/feat/0001b-live-view-smoothing.md "Sparkline Y-axis scaling".

export type SparklineMetric = 'watts' | 'split' | 'dps' | 'spm' | 'hf'

export type AxisConfig = {
  /** Smallest window to render. */
  minRange: number
  /** Absolute hard floor. */
  clampMin: number
  /** Absolute hard ceiling. */
  clampMax: number
}

export const axisConfig: Record<SparklineMetric, AxisConfig> = {
  watts: { minRange: 100, clampMin: 0, clampMax: 600 },
  split: { minRange: 30, clampMin: 60, clampMax: 240 },
  dps: { minRange: 4, clampMin: 0, clampMax: 20 },
  spm: { minRange: 10, clampMin: 0, clampMax: 50 },
  hf: { minRange: 40, clampMin: 40, clampMax: 200 },
}

export type AxisBounds = {
  yMin: number
  yMax: number
  /** null when values.length === 0 */
  dataMin: number | null
  dataMax: number | null
}

export function computeAxis(values: number[], metric: SparklineMetric): AxisBounds {
  const { minRange, clampMin, clampMax } = axisConfig[metric]

  if (values.length === 0) {
    return { yMin: clampMin, yMax: clampMax, dataMin: null, dataMax: null }
  }

  let dataMin = values[0]
  let dataMax = values[0]
  for (let i = 1; i < values.length; i++) {
    const v = values[i]
    if (v < dataMin) dataMin = v
    if (v > dataMax) dataMax = v
  }
  const range = dataMax - dataMin
  const desired = Math.max(range * 1.2, minRange)
  const center = (dataMin + dataMax) / 2
  let yMin = center - desired / 2
  let yMax = center + desired / 2
  if (yMin < clampMin) yMin = clampMin
  if (yMax > clampMax) yMax = clampMax
  return { yMin, yMax, dataMin, dataMax }
}
