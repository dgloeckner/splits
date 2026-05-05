// Package stats holds derived-statistics computations that run over a
// session's strokes at session_end time, before the strokes are
// compacted away. See FEAT-0009 (cleanup) and FEAT-0010 (PBs).
package stats

import "github.com/gloeckner-daniel/splits/internal/event"

// DefaultBucketStrokes is the bucket size used by ComputeSamples when
// the caller does not specify one. Five strokes is roughly 6–10 s of
// rowing — small enough to render shape, large enough to keep the
// sample array short for long sessions.
const DefaultBucketStrokes = 5

// MaxSampleBuckets caps the length of the per-session samples series
// stored in summary_json. Long sessions grow the bucket size instead
// of the array (see BucketStrokesFor).
const MaxSampleBuckets = 360

// BucketStrokesFor returns a bucket size that keeps ComputeSamples'
// output series at or under MaxSampleBuckets. Uses DefaultBucketStrokes
// for short sessions and grows the bucket proportionally for long ones.
func BucketStrokesFor(totalStrokes int) int {
	if totalStrokes <= 0 {
		return DefaultBucketStrokes
	}
	n := (totalStrokes + MaxSampleBuckets - 1) / MaxSampleBuckets
	if n < DefaultBucketStrokes {
		return DefaultBucketStrokes
	}
	return n
}

// ComputeSamples averages stroke-level metrics into N-stroke buckets
// for storage in summary_json.samples. Strokes must be ordered by
// stroke_no ascending. A trailing partial bucket is included when it
// has at least one stroke.
//
// The returned series carries one entry per bucket: the bucket's
// final TimeSec, its rounded mean PaceSecPer500m, PowerW, and SPM.
func ComputeSamples(strokes []event.StrokePayload, bucketStrokes int) *event.SessionSamples {
	if bucketStrokes <= 0 {
		bucketStrokes = DefaultBucketStrokes
	}
	if len(strokes) == 0 {
		return &event.SessionSamples{BucketStrokes: bucketStrokes}
	}

	nBuckets := (len(strokes) + bucketStrokes - 1) / bucketStrokes
	out := &event.SessionSamples{
		BucketStrokes: bucketStrokes,
		T:             make([]float64, 0, nBuckets),
		Split:         make([]int, 0, nBuckets),
		Watt:          make([]int, 0, nBuckets),
		SPM:           make([]int, 0, nBuckets),
		DPS:           make([]float64, 0, nBuckets),
		SPI:           make([]int, 0, nBuckets),
	}

	for start := 0; start < len(strokes); start += bucketStrokes {
		end := start + bucketStrokes
		if end > len(strokes) {
			end = len(strokes)
		}
		var paceSum, wattSum, spmSum int
		var dpsSum float64
		var spiSum, spiCount int
		for i := start; i < end; i++ {
			s := strokes[i]
			paceSum += s.PaceSecPer500m
			wattSum += s.PowerW
			spmSum += s.SPM
			dpsSum += s.DPS
			if s.SPM > 0 && s.PowerW >= 20 {
				spiSum += s.PowerW / s.SPM
				spiCount++
			}
		}
		n := end - start
		out.T = append(out.T, strokes[end-1].TimeSec)
		out.Split = append(out.Split, paceSum/n)
		out.Watt = append(out.Watt, wattSum/n)
		out.SPM = append(out.SPM, spmSum/n)
		out.DPS = append(out.DPS, dpsSum/float64(n))
		spiBucket := 0
		if spiCount > 0 {
			spiBucket = spiSum / spiCount
		}
		out.SPI = append(out.SPI, spiBucket)
	}
	return out
}
