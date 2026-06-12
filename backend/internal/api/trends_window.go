package api

import "time"

// trendsWindow is the one rolling window scoping everything on the
// Verlauf surface. Windows are rolling and end now (Berlin time):
// 30d = last 30 days, 365d = last 365 days, all = everything. The
// prior window is always the equal-length window immediately before —
// the fair-delta invariant the volume footnote depends on.
type trendsWindow struct {
	Key                string
	Days               int // 0 for "all"
	From, To           time.Time
	PriorFrom, PriorTo time.Time
}

func (w trendsWindow) HasPrior() bool { return w.Days > 0 }

func computeTrendsWindow(key string, now time.Time) (trendsWindow, bool) {
	w := trendsWindow{Key: key, To: now}
	switch key {
	case "30d":
		w.Days = 30
	case "365d":
		w.Days = 365
	case "all":
		return w, true // From stays zero ("everything"); no prior.
	default:
		return trendsWindow{}, false
	}
	w.From = now.AddDate(0, 0, -w.Days)
	w.PriorTo = w.From
	w.PriorFrom = now.AddDate(0, 0, -2*w.Days)
	return w, true
}
