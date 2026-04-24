export type Range = { lo: number; hi: number | null }
export type RangeStatus = 'in' | 'under' | 'over' | 'none'

export function inRange(value: number | null | undefined, range: Range | undefined): RangeStatus {
  if (value == null || value === 0 || !range) return 'none'
  if (value < range.lo) return 'under'
  if (range.hi != null && value > range.hi) return 'over'
  return 'in'
}
