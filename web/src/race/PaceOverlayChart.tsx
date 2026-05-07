import { reconstructDistance } from './distance'

type Series = { color: string; label: string; tSec: number[]; split: number[] }
type Props = { series: Series[]; totalMeters: number; width: number; height: number }

export function PaceOverlayChart({ series, totalMeters, width, height }: Props) {
  const padding = { left: 32, right: 8, top: 8, bottom: 24 }
  const xRange = [padding.left, width - padding.right]
  const yRange = [padding.top, height - padding.bottom]

  const all = series.map((s) => ({
    color: s.color,
    label: s.label,
    points: zipDistanceSplit(s),
  }))
  const allSplits = all.flatMap((s) => s.points.map((p) => p.split))
  const yMin = allSplits.length ? Math.min(...allSplits) * 0.95 : 0
  const yMax = allSplits.length ? Math.max(...allSplits) * 1.05 : 1
  const ySpan = yMax - yMin || 1

  const xAt = (m: number) =>
    xRange[0] + (totalMeters > 0 ? m / totalMeters : 0) * (xRange[1] - xRange[0])
  const yAt = (s: number) => yRange[1] - ((s - yMin) / ySpan) * (yRange[1] - yRange[0])

  return (
    <svg width={width} height={height} role="img" aria-label="Pace overlay">
      <line
        x1={xRange[0]}
        y1={yRange[1]}
        x2={xRange[1]}
        y2={yRange[1]}
        stroke="currentColor"
        strokeOpacity="0.3"
      />
      <line
        x1={xRange[0]}
        y1={yRange[0]}
        x2={xRange[0]}
        y2={yRange[1]}
        stroke="currentColor"
        strokeOpacity="0.3"
      />
      {all.map((s, i) => (
        <polyline
          key={i}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          points={s.points.map((p) => `${xAt(p.distance)},${yAt(p.split)}`).join(' ')}
        />
      ))}
    </svg>
  )
}

function zipDistanceSplit(s: Series): { distance: number; split: number }[] {
  const distM = reconstructDistance({ tSec: s.tSec, split: s.split })
  return distM.map((d, i) => ({ distance: d, split: s.split[i] }))
}
