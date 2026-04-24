import type { Workout } from '../api/workouts'
import { intensityRanges } from '../pages/workout/intensityRanges'

export type SegmentKind = 'warmup' | 'work' | 'rest' | 'cooldown'

export type Range = { lo: number; hi: number | null }

export type Segment = {
  kind: SegmentKind
  index: number
  durationSec?: number
  distanceM?: number
  targetSplit?: Range
  targetSPM?: Range
  startTimeSec: number
  endTimeSec: number
  startDistanceM: number
  endDistanceM: number
}

export type ActiveSegment = {
  segment: Segment
  remainingSec?: number
  remainingM?: number
  progressRatio: number
  totalSegments: number
  activeIndexOneBased: number
}

export function expandWorkout(w: Workout): Segment[] {
  const out: Segment[] = []
  const ranges = w.intensity ? intensityRanges[w.intensity] : undefined

  if (w.warmup_sec > 0) {
    out.push(blankSeg('warmup', { durationSec: w.warmup_sec }))
  }

  if (w.mode === 'distance') {
    out.push(workSeg(w.params as { meters: number }, undefined, ranges))
  } else if (w.mode === 'time') {
    out.push(workSeg(undefined, (w.params as { seconds: number }).seconds, ranges))
  } else if (w.mode === 'intervals') {
    const p = w.params as { reps: number; length: { unit: 'm' | 'min'; value: number }; rest_sec: number }
    for (let i = 0; i < p.reps; i++) {
      if (p.length.unit === 'm') {
        out.push(workSeg({ meters: p.length.value }, undefined, ranges))
      } else {
        out.push(workSeg(undefined, Math.round(p.length.value * 60), ranges))
      }
      if (i < p.reps - 1) {
        out.push(blankSeg('rest', { durationSec: p.rest_sec }))
      }
    }
  }

  if (w.cooldown_sec > 0) {
    out.push(blankSeg('cooldown', { durationSec: w.cooldown_sec }))
  }

  // Cumulative offsets + index.
  let cumT = 0
  let cumD = 0
  out.forEach((seg, i) => {
    seg.index = i
    seg.startTimeSec = cumT
    seg.startDistanceM = cumD
    if (seg.durationSec) cumT += seg.durationSec
    if (seg.distanceM) cumD += seg.distanceM
    seg.endTimeSec = cumT
    seg.endDistanceM = cumD
  })

  return out
}

function blankSeg(kind: SegmentKind, p: { durationSec?: number; distanceM?: number }): Segment {
  return {
    kind, index: 0,
    durationSec: p.durationSec, distanceM: p.distanceM,
    startTimeSec: 0, endTimeSec: 0, startDistanceM: 0, endDistanceM: 0,
  }
}

function workSeg(
  dist: { meters: number } | undefined,
  durationSec: number | undefined,
  ranges: { splitSec: Range; spm: Range } | undefined,
): Segment {
  return {
    kind: 'work', index: 0,
    distanceM: dist?.meters,
    durationSec,
    targetSplit: ranges?.splitSec,
    targetSPM: ranges?.spm,
    startTimeSec: 0, endTimeSec: 0, startDistanceM: 0, endDistanceM: 0,
  }
}

export function locateSegment(
  segments: Segment[],
  distanceM: number,
  timeSec: number,
): ActiveSegment | null {
  if (segments.length === 0) return null
  // timeAnchor tracks the cumulative seconds consumed by time-based segments so far.
  // After a completed distance segment, subsequent time-based segments (e.g. rest)
  // are measured from the current timeSec because we don't know the exact wall-clock
  // moment the distance was reached. However, if the NEXT distance segment has
  // already been entered, we treat any interleaved time-based segment as consumed.
  let timeAnchor = 0
  let afterDistance = false

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx]
    if (seg.durationSec != null) {
      if (afterDistance) {
        // Rest (or any time-based segment) following a distance segment: it is
        // "consumed" if the next distance-based segment in the list has already
        // been entered (distanceM > that segment's startDistanceM).
        const nextDistSeg = segments.slice(idx + 1).find((s) => s.distanceM != null)
        const nextDistStarted = nextDistSeg != null && distanceM > nextDistSeg.startDistanceM
        if (!nextDistStarted) {
          // Rest timer starts from the current moment (we just finished the distance
          // segment). Use timeSec as the new anchor.
          const consumed = 0
          if (consumed < seg.durationSec) {
            return {
              segment: seg,
              remainingSec: seg.durationSec,
              progressRatio: 0,
              totalSegments: segments.length,
              activeIndexOneBased: seg.index + 1,
            }
          }
        }
        afterDistance = false
        timeAnchor += seg.durationSec
      } else {
        const consumed = Math.max(0, timeSec - timeAnchor)
        if (consumed < seg.durationSec) {
          return {
            segment: seg,
            remainingSec: Math.max(0, seg.durationSec - consumed),
            progressRatio: consumed / seg.durationSec,
            totalSegments: segments.length,
            activeIndexOneBased: seg.index + 1,
          }
        }
        timeAnchor += seg.durationSec
      }
    } else if (seg.distanceM != null) {
      const consumed = Math.max(0, distanceM - seg.startDistanceM)
      if (consumed < seg.distanceM) {
        return {
          segment: seg,
          remainingM: Math.max(0, seg.distanceM - consumed),
          progressRatio: consumed / seg.distanceM,
          totalSegments: segments.length,
          activeIndexOneBased: seg.index + 1,
        }
      }
      afterDistance = true
    }
  }
  return null
}
