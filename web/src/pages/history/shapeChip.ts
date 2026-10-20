import type { TrendsPoint } from '../../api/client'

// The workout chip of a session: the series name, else the mode.
export function shapeChip(q: TrendsPoint, labels: Map<string, string>): string {
  const fromSeries = q.shape_hash ? labels.get(q.shape_hash) : undefined
  if (fromSeries) return fromSeries
  switch (q.mode) {
    case 'just_row': return 'Just Row'
    case 'intervals': return 'Intervalle'
    case 'time': return 'Zeit'
    case 'distance': return 'Distanz'
  }
  return q.mode || 'Just Row'
}
