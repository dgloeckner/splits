export const distancePresets: { label: string; meters: number }[] = [
  { label: '500 m', meters: 500 },
  { label: '1 km', meters: 1000 },
  { label: '2 km', meters: 2000 },
  { label: '5 km', meters: 5000 },
  { label: '6 km', meters: 6000 },
  { label: '10 km', meters: 10000 },
  { label: 'HM', meters: 21097 },
  { label: 'Marathon', meters: 42195 },
]

export const timePresets: { label: string; seconds: number }[] = [
  { label: '10 min', seconds: 600 },
  { label: '20 min', seconds: 1200 },
  { label: '30 min', seconds: 1800 },
  { label: '45 min', seconds: 2700 },
  { label: '60 min', seconds: 3600 },
]

export type IntervalPreset = {
  label: string
  reps: number
  length: { unit: 'm' | 'min'; value: number }
  rest_sec: number
}
export const intervalPresets: IntervalPreset[] = [
  { label: '8×500 m', reps: 8, length: { unit: 'm', value: 500 }, rest_sec: 120 },
  { label: '5×1000 m', reps: 5, length: { unit: 'm', value: 1000 }, rest_sec: 180 },
  { label: '4×2000 m', reps: 4, length: { unit: 'm', value: 2000 }, rest_sec: 300 },
  { label: '6×1 min', reps: 6, length: { unit: 'min', value: 1 }, rest_sec: 60 },
  { label: '4×4 min', reps: 4, length: { unit: 'min', value: 4 }, rest_sec: 120 },
]

export const racePresets: { label: string; meters: number }[] = [
  { label: '500 m',    meters: 500 },
  { label: '1 000 m',  meters: 1000 },
  { label: '2 000 m',  meters: 2000 },
  { label: '5 000 m',  meters: 5000 },
  { label: '6 000 m',  meters: 6000 },
  { label: '10 000 m', meters: 10000 },
  { label: 'Halbmarathon', meters: 21097 },
  { label: 'Marathon',    meters: 42195 },
]
