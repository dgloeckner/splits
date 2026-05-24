// Package ipm decodes the FDF IPM serial protocol (INT-0001). Frames
// emitted by the parser are consumed by the sessionizer in M2; in M1
// they are printed to stdout by cmd/splits for protocol verification.
package ipm

import "time"

// Frame is one decoded A8 live-data message. Field offsets reference
// the 27-digit payload layout in INT-0001 (after the A8 prefix is
// stripped).
//
// The May-2026 spec revision corrected several field boundaries that
// the original local decode had wrong; see specs/int/0001 §"How
// earlier 'unknowns' were resolved" for the trail. Notable changes
// from the prior Frame struct:
//
//   - DistanceM is the 5-digit value from [5:10], not 4 digits from
//     [6:10] (wraps at 100 km instead of 10 km).
//   - DeviceSplitPaceSec is new — the rower console's own smoothed
//     500 m split, sourced from [11:15]. Prefer this over any
//     host-side derivation when non-zero.
//   - SPM is 3 digits [15:18], not 2 from [16:18].
//   - CalPerHr is the 4-digit value [21:25], not the 3-digit [21:24]
//     × 10 — the units digit was silently truncated.
//   - The Marker / Unknown / Footer string fields are removed; what
//     they encoded is now exposed properly (split-pace) or absorbed
//     into the correctly-sized cal/hr / SPM / distance fields.
type Frame struct {
	ReceivedAt time.Time // host wall-clock time the frame was parsed

	TimeSec            float64 // [1:5]  elapsed seconds (integer-second resolution on this firmware)
	DistanceM          int     // [5:10] cumulative distance in meters
	DeviceClass        string  // [10]   single digit, constant "1" on firmware V115; unverified meaning
	DeviceSplitPaceSec int     // [11:15] rower's own 500 m split in seconds (0 = no value)
	SPM                int     // [15:18] strokes per minute
	PowerW             int     // [18:21] watts
	CalPerHr           int     // [21:25] calories per hour
	Level              int     // [25:27] resistance level 1-16

	RawPayload string // original 27-digit ASCII payload without the "A8" prefix
}
