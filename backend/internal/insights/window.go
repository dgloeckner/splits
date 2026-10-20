package insights

import "github.com/gloeckner-daniel/splits/internal/event"

// analysed is the slice of a session's samples the detectors evaluate:
// the analysis window (FEAT-0011 §Analysefenster) when the samples
// carry one, the full series otherwise. From/To are the window bounds
// in the full series and go into every finding's evidence.
type analysed struct {
	Split, Watt, SPM []int
	DPS              []float64
	From, To         int
}

func analysedSamples(s *event.SessionSamples) analysed {
	n := len(s.Split)
	from, to := 0, n
	if w := s.Window; w != nil && w.From >= 0 && w.From < w.To && w.To <= n {
		from, to = w.From, w.To
	}
	a := analysed{Split: s.Split[from:to], From: from, To: to}
	if len(s.Watt) >= to {
		a.Watt = s.Watt[from:to]
	}
	if len(s.SPM) >= to {
		a.SPM = s.SPM[from:to]
	}
	if len(s.DPS) >= to {
		a.DPS = s.DPS[from:to]
	}
	return a
}

// withWindow adds the window bounds to a finding's evidence map.
func (a analysed) withWindow(ev map[string]float64) map[string]float64 {
	ev["window_from"] = float64(a.From)
	ev["window_to"] = float64(a.To)
	return ev
}
