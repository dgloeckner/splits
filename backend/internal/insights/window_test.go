package insights

import (
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// startSpikeSplits: a 160 s bucket from standstill, then a 105–111 s
// body — the shape of the 11.06.2026 session (#36).
func startSpikeSplits() []int {
	body := []int{108, 106, 109, 111, 107, 108, 105, 110, 108, 107, 109, 108, 106, 110, 108, 107, 109, 111, 108, 106}
	return append([]int{160}, body...)
}

func withWindow(s *event.SessionSamples, from, to int) *event.SessionSamples {
	s.Window = &event.SamplesWindow{From: from, To: to}
	return s
}

func TestConsistencyWindowDropsStartBucket(t *testing.T) {
	splits := startSpikeSplits()

	full, ok := DetectConsistency(samplesFromSplits(splits))
	if !ok {
		t.Fatal("expected finding without window")
	}
	if full.Evidence["cv"] < CVMid {
		t.Fatalf("without window cv = %.2f, want ≥ %.0f (the start bucket dominates)", full.Evidence["cv"], CVMid)
	}

	f, ok := DetectConsistency(withWindow(samplesFromSplits(splits), 1, len(splits)))
	if !ok {
		t.Fatal("expected finding with window")
	}
	if f.Evidence["cv"] >= CVMid {
		t.Fatalf("with window cv = %.2f, want < %.0f", f.Evidence["cv"], CVMid)
	}
	if f.Code == CodeInconsistent {
		t.Errorf("code = %q, want a consistent label", f.Code)
	}
	if f.Evidence["window_from"] != 1 || f.Evidence["window_to"] != float64(len(splits)) {
		t.Errorf("evidence window = [%v, %v), want [1, %d)", f.Evidence["window_from"], f.Evidence["window_to"], len(splits))
	}
}

func TestPacingWindowExcludesStartBucket(t *testing.T) {
	splits := startSpikeSplits()
	f, ok := DetectPacing(withWindow(samplesFromSplits(splits), 1, len(splits)))
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeEvenSplit {
		t.Fatalf("code = %q, want EVEN_SPLIT", f.Code)
	}
	body := splits[1:]
	if want := meanInt(body[:len(body)/2]); f.Evidence["h1"] != want {
		t.Errorf("h1 = %v, want %v (body only, no start bucket)", f.Evidence["h1"], want)
	}
}

func TestFadeWindowIgnoresOverrun(t *testing.T) {
	// Steady 300 W piece; the three buckets after the goal are the
	// let-go at 100 W.
	watts := []int{300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 100, 100, 100}
	if _, ok := DetectFade(samplesFromWatts(watts)); !ok {
		t.Fatal("without window the overrun must read as a fade (precondition)")
	}
	if f, ok := DetectFade(withWindow(samplesFromWatts(watts), 1, 12)); ok {
		t.Fatalf("with window: unexpected fade %q", f.MessageDE)
	}
}

func TestFadeWindowDoesNotHideRealFade(t *testing.T) {
	// A genuine fade in the last fifth of the piece, then an overrun
	// sprint after the goal that would lift the tail back up.
	watts := []int{300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 240, 240, 240, 420, 420}
	if _, ok := DetectFade(samplesFromWatts(watts)); ok {
		t.Fatal("without window the overrun must hide the fade (precondition)")
	}
	f, ok := DetectFade(withWindow(samplesFromWatts(watts), 1, 13))
	if !ok {
		t.Fatal("with window: expected fade")
	}
	if f.Evidence["window_to"] != 13 {
		t.Errorf("window_to = %v, want 13", f.Evidence["window_to"])
	}
}

func TestDetectorsWithoutWindowUseFullSeries(t *testing.T) {
	splits := startSpikeSplits()
	s := samplesFromSplits(splits)
	for _, detect := range []func(*event.SessionSamples) (Finding, bool){DetectPacing, DetectConsistency} {
		f, ok := detect(s)
		if !ok {
			t.Fatal("expected finding")
		}
		if f.Evidence["window_from"] != 0 || f.Evidence["window_to"] != float64(len(splits)) {
			t.Errorf("%s: evidence window = [%v, %v), want full [0, %d)",
				f.DetectorID, f.Evidence["window_from"], f.Evidence["window_to"], len(splits))
		}
	}
}

func TestAnalysedSamplesRejectsBadWindow(t *testing.T) {
	for _, w := range []event.SamplesWindow{{From: 3, To: 3}, {From: -1, To: 4}, {From: 1, To: 99}} {
		s := samplesFromSplits([]int{1, 2, 3, 4, 5})
		s.Window = &w
		if a := analysedSamples(s); a.From != 0 || a.To != 5 || len(a.Watt) != 5 {
			t.Errorf("window %+v: got [%d, %d) with %d watts, want full series", w, a.From, a.To, len(a.Watt))
		}
	}
}
