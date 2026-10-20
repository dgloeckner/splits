import { readFileSync } from 'node:fs'

export type FixtureFrame = {
  timeSec: number
  distanceM: number
  spm: number
  powerW: number
}

export type FixtureStats = {
  frames: FixtureFrame[]
  /** Frames with spm > 0 — what the sessionizer counts as a stroke. */
  strokeFrames: FixtureFrame[]
  finalDistanceM: number
  finalTimeSec: number
  firstStrokeTimeSec: number
  firstStrokeDistanceM: number
  /** finalTimeSec - firstStrokeTimeSec. */
  durationSec: number
  /** Active distance covered. finalDistance - firstStrokeDistance. */
  distanceCoveredM: number
  /** Mean pace in sec/500m over active stroke window. */
  avgPaceSecPer500m: number
  /** Stroke count = number of frames with spm > 0. */
  strokeCount: number
  avgSPM: number
  avgPowerW: number
  avgPaceText: string
}

/** Parses an IPM-CSV fixture into per-frame numbers + summary stats. */
export function loadFixtureStats(absPath: string): FixtureStats {
  const raw = readFileSync(absPath, 'utf8').trim().split(/\r?\n/)
  const header = raw[0].split(',')
  const idx = (name: string) => header.indexOf(name)
  const iT = idx('time_sec')
  const iD = idx('distance_m')
  const iSpm = idx('spm')
  const iPow = idx('power_w')
  const frames: FixtureFrame[] = raw.slice(1).map((line) => {
    const c = line.split(',')
    return {
      timeSec: Number(c[iT]),
      distanceM: Number(c[iD]),
      spm: Number(c[iSpm]),
      powerW: Number(c[iPow]),
    }
  })
  const strokeFrames = frames.filter((f) => f.spm > 0)
  const last = frames[frames.length - 1]
  const first = strokeFrames[0]
  const durationSec = last.timeSec - first.timeSec
  const distanceCoveredM = last.distanceM - first.distanceM
  const avgPaceSecPer500m = (500 * durationSec) / distanceCoveredM
  const avgSPM = strokeFrames.reduce((a, f) => a + f.spm, 0) / strokeFrames.length
  const avgPowerW = strokeFrames.reduce((a, f) => a + f.powerW, 0) / strokeFrames.length
  const m = Math.floor(avgPaceSecPer500m / 60)
  const s = avgPaceSecPer500m - m * 60
  const avgPaceText = `${m}:${s.toFixed(1).padStart(4, '0')}`
  return {
    frames,
    strokeFrames,
    finalDistanceM: last.distanceM,
    finalTimeSec: last.timeSec,
    firstStrokeTimeSec: first.timeSec,
    firstStrokeDistanceM: first.distanceM,
    durationSec,
    distanceCoveredM,
    avgPaceSecPer500m,
    strokeCount: strokeFrames.length,
    avgSPM,
    avgPowerW,
    avgPaceText,
  }
}

/** Parse "m:ss.d" or "m:ss" into seconds. */
export function paceToSeconds(text: string): number {
  const m = /^(\d+):(\d{2}(?:[.,]\d)?)$/.exec(text.trim().replace(',', '.'))
  if (!m) return NaN
  return Number(m[1]) * 60 + Number(m[2])
}

/** Parse "m:ss" into seconds. */
export function mmssToSeconds(text: string): number {
  const m = /^(\d+):(\d{2})(?:\.\d)?$/.exec(text.trim())
  if (!m) return NaN
  return Number(m[1]) * 60 + Number(m[2])
}
