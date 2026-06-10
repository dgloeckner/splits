/** mm:ss with carry-safe rounding (119.6 → "2:00", never "1:60"). */
export function fmtMmSs(seconds: number): string {
  const sign = seconds < 0 ? '-' : ''
  const total = Math.round(Math.abs(seconds))
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${sign}${m}:${String(s).padStart(2, '0')}`
}

/** mm:ss.t with carry-safe rounding (119.96 → "2:00.0", never "1:60.0"). */
export function fmtMmSsTenths(seconds: number): string {
  const sign = seconds < 0 ? '-' : ''
  const tenths = Math.round(Math.abs(seconds) * 10)
  const m = Math.floor(tenths / 600)
  const rem = tenths - m * 600
  return `${sign}${m}:${(rem / 10).toFixed(1).padStart(4, '0')}`
}
