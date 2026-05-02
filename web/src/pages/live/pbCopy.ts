import type { DistancePB, WindowPB } from '../../api/client'
import { mmssWhole, pace500m } from '../../util/format'

export type PBKind = 'distance' | 'window'
export type PBIcon = 'medal' | 'lightning' | 'stopwatch' | 'bolt'

export function pbTitleDistance(p: DistancePB): string {
  const d = p.distance_m
  if (d >= 1000) return `Neue ${d / 1000} km-Bestzeit!`
  return `Neue ${d}m-Bestzeit!`
}

export function pbTitleWindow(p: WindowPB): string {
  switch (p.metric) {
    case 'power': return 'Neue Wattbestzeit!'
    case 'pace':  return 'Neue Pace-Bestzeit!'
    case 'dps':   return 'Neue DPS-Bestzeit!'
    case 'spi':   return 'Neue SPI-Bestzeit!'
    default:      return `Neue ${p.metric}-Bestzeit!`
  }
}

export function pbHeroValue(kind: PBKind, p: DistancePB | WindowPB): string {
  if (kind === 'distance') {
    const dp = p as DistancePB
    const t = dp.time_sec
    const d = dp.distance_m
    if (d >= 1000) return formatHHMMSS(t)
    // Sub-1km: show split as whole-second mm:ss (e.g. 500m@98s -> "1:38")
    return mmssWhole(Math.round((t * 500) / d))
  }
  const w = p as WindowPB
  switch (w.metric) {
    case 'power': return `${Math.round(w.value)} W`
    case 'pace':  return pace500m(w.value)
    case 'dps':   return w.value.toFixed(1) + ' m'
    case 'spi':   return w.value.toFixed(1)
    default:      return String(w.value)
  }
}

export function pbDeltaText(kind: PBKind, p: DistancePB | WindowPB): string {
  if (kind === 'distance') {
    const dp = p as DistancePB
    if (dp.previous_time_sec === undefined) return ''
    const delta = dp.previous_time_sec - dp.time_sec
    const prev = dp.distance_m >= 1000 ? formatHHMMSS(dp.previous_time_sec) : mmssWhole(dp.previous_time_sec)
    return `vorher ${prev} — schneller um ${formatDelta(delta)}`
  }
  const w = p as WindowPB
  if (w.previous_value === undefined) return ''
  const delta = w.value - w.previous_value
  const sign = delta >= 0 ? '+' : ''
  switch (w.metric) {
    case 'power': return `vorher ${Math.round(w.previous_value)} W — ${sign}${Math.round(delta)} W`
    case 'pace':  return `vorher ${pace500m(w.previous_value)} — schneller um ${formatDelta(w.previous_value - w.value)}`
    default:      return `vorher ${w.previous_value.toFixed(1)} — ${sign}${delta.toFixed(1)}`
  }
}

export function pbIcon(kind: PBKind, metric?: string): PBIcon {
  if (kind === 'distance') return 'medal'
  switch (metric) {
    case 'power': return 'lightning'
    case 'pace':  return 'stopwatch'
    case 'dps':
    case 'spi':
    default:      return 'bolt'
  }
}

function formatHHMMSS(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
  const r = (s % 60).toString().padStart(2, '0')
  return `${h.toString().padStart(2, '0')}:${m}:${r}`
}

function formatDelta(deltaSec: number): string {
  const abs = Math.abs(deltaSec)
  if (abs >= 60) {
    const m = Math.floor(abs / 60)
    const s = Math.round(abs % 60)
    return `${m}:${s.toString().padStart(2, '0')} min`
  }
  return `${Math.round(abs)} s`
}
