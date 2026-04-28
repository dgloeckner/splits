// Package ipm decodes the FDF IPM serial protocol (INT-0001). Frames
// emitted by the parser are consumed by the sessionizer in M2; in M1
// they are printed to stdout by cmd/splits for protocol verification.
package ipm

import "time"

// Frame is one decoded A8 live-data message. Field numbers reference
// the 27-digit payload layout in INT-0001.
type Frame struct {
	ReceivedAt time.Time // server wall-clock time the frame was parsed

	TimeSec    float64 // [0:6]  MMM SS T — elapsed rowing time
	DistanceM  int     // [6:10] cumulative distance in meters
	Marker     string  // [10:13] pass-through, unverified
	Unknown    string  // [13:16] pass-through, unverified
	SPM        int     // [16:18] strokes per minute
	PowerW     int     // [18:21] watts
	CalPerHr   int     // [21:24] × 10 — calories per hour
	Footer     string  // [24:25] single-digit pass-through, unverified
	Level      int     // [25:27] resistance level 1-16

	RawPayload string // original 27-digit ASCII payload without the "A8" prefix
}
