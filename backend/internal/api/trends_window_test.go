package api

import (
	"testing"
	"time"
)

func TestTrendsWindowEqualLengthInvariant(t *testing.T) {
	// Includes DST transitions (Berlin: 2026-03-29, 2026-10-25) and a
	// leap-day-adjacent date.
	nows := []string{
		"2026-06-12T10:00:00", "2026-03-30T08:00:00", "2026-10-26T08:00:00",
		"2026-01-01T00:30:00", "2024-03-01T12:00:00",
	}
	for _, ns := range nows {
		now, err := time.ParseInLocation("2006-01-02T15:04:05", ns, berlinLoc)
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"30d", "365d"} {
			w, ok := computeTrendsWindow(key, now)
			if !ok {
				t.Fatalf("%s rejected", key)
			}
			if !w.To.Equal(now) || !w.PriorTo.Equal(w.From) {
				t.Fatalf("%s @ %s: windows not contiguous", key, ns)
			}
			// Equal length in calendar days, for every now.
			if d1, d2 := calendarDays(w.From, w.To), calendarDays(w.PriorFrom, w.PriorTo); d1 != d2 {
				t.Fatalf("%s @ %s: window %d days, prior %d days", key, ns, d1, d2)
			}
		}
	}
}

func calendarDays(from, to time.Time) int {
	n := 0
	for d := from; d.Before(to); d = d.AddDate(0, 0, 1) {
		n++
	}
	return n
}

func TestTrendsWindowAll(t *testing.T) {
	now := time.Date(2026, 6, 12, 10, 0, 0, 0, berlinLoc)
	w, ok := computeTrendsWindow("all", now)
	if !ok || !w.From.IsZero() || w.HasPrior() {
		t.Fatalf("all: %+v ok=%v", w, ok)
	}
	if _, ok := computeTrendsWindow("week", now); ok {
		t.Fatal("legacy 'week' must be rejected")
	}
}
