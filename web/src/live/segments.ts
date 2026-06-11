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

/** Tracks the workTimeSec at which each distance segment was first crossed.
 *  WeakMap ensures entries are GC'd when the segment array is recreated
 *  (e.g. after expandWorkout is called again), preventing stale anchors.
 *  Keyed on the segment object from the current expandWorkout call. */
const crossedAtByDistanceSeg = new WeakMap<Segment, number>()

export function locateSegment(
  segments: Segment[],
  /** Backend-stamped `work_distance_m`: metres rowed since the work phase
   *  started. Already offset by warmup distance; distance segments are
   *  evaluated relative to this value directly. */
  workDistanceM: number,
  /** Backend-stamped `work_time_sec`: seconds elapsed since the work phase
   *  started. Used to count down time-based segments (rest, cooldown). */
  workTimeSec: number,
): ActiveSegment | null {
  if (segments.length === 0) return null
  let timeAnchor = 0
  // workCompletedAt: workTimeSec at which the most recently completed
  // distance segment's target distance was crossed. Tracked so that
  // a following time-based segment (rest or cooldown) can anchor its
  // countdown to that moment instead of work-phase start.
  let workCompletedAt: number | null = null

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx]
    if (seg.durationSec != null) {
      if (workCompletedAt != null) {
        // Time-based segment following a distance segment.
        // Rest persists until durationSec elapses — no early-exit when the
        // rower's distance enters the next interval. Matches backend
        // phaseplan.go:204-225 which has no rest-skip rule.
        const consumed = Math.max(0, workTimeSec - workCompletedAt)
        if (consumed < seg.durationSec) {
          return {
            segment: seg,
            remainingSec: Math.max(0, seg.durationSec - consumed),
            progressRatio: consumed / seg.durationSec,
            totalSegments: segments.length,
            activeIndexOneBased: seg.index + 1,
          }
        }
        workCompletedAt += seg.durationSec
        timeAnchor = workCompletedAt
      } else {
        const consumed = Math.max(0, workTimeSec - timeAnchor)
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
      const consumed = Math.max(0, workDistanceM - seg.startDistanceM)
      if (consumed < seg.distanceM) {
        return {
          segment: seg,
          remainingM: Math.max(0, seg.distanceM - consumed),
          progressRatio: consumed / seg.distanceM,
          totalSegments: segments.length,
          activeIndexOneBased: seg.index + 1,
        }
      }
      // Record the workTimeSec at which this distance target was first
      // crossed. Subsequent calls with the same segments object will reuse
      // this anchor so the following time-based segment (rest or cooldown)
      // counts down correctly even when the rower has stopped.
      if (!crossedAtByDistanceSeg.has(seg)) {
        crossedAtByDistanceSeg.set(seg, workTimeSec)
      }
      workCompletedAt = crossedAtByDistanceSeg.get(seg)!
    }
  }
  return null
}
