export function vibrate(pattern: number | number[]): boolean {
  if (typeof navigator === 'undefined') return false
  const n = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }
  return typeof n.vibrate === 'function' ? n.vibrate(pattern) : false
}
