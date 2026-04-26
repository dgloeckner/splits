// Fritsch–Carlson monotone cubic: one tangent per knot, then cubic
// Bézier segments. Does NOT overshoot recorded peaks. Shared by
// Sparkline, LineChart, and DualLineChart.
export function monotonePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  const n = pts.length
  const dx: number[] = new Array(n - 1)
  const dy: number[] = new Array(n - 1)
  const m: number[] = new Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    dy[i] = pts[i + 1].y - pts[i].y
    m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i]
  }
  const t: number[] = new Array(n)
  t[0] = m[0]
  t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0
    else t[i] = (m[i - 1] + m[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
    } else {
      const a = t[i] / m[i]
      const b = t[i + 1] / m[i]
      const h = Math.hypot(a, b)
      if (h > 3) {
        const s = 3 / h
        t[i] = s * a * m[i]
        t[i + 1] = s * b * m[i]
      }
    }
  }
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3
    const y1 = pts[i].y + (t[i] * dx[i]) / 3
    const x2 = pts[i + 1].x - dx[i] / 3
    const y2 = pts[i + 1].y - (t[i + 1] * dx[i]) / 3
    d += ` C ${x1.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} ${pts[i + 1].x.toFixed(2)} ${pts[i + 1].y.toFixed(2)}`
  }
  return d
}
