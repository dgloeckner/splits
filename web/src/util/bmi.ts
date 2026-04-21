export function computeBMI(weightKg: number | undefined, heightCm: number | undefined): number | null {
  if (weightKg == null || heightCm == null) return null
  if (heightCm <= 0) return null
  const m = heightCm / 100
  const v = weightKg / (m * m)
  return Math.round(v * 10) / 10
}
