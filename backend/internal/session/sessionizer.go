package session

import (
	"context"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/ipm"
	"github.com/oklog/ulid/v2"
)

// Options configures a Sessionizer. IdleTimeout controls the gap
// between stroke frames that closes a session. RowerID/RowerName are
// stubbed attribution per ARCH-0001 (real auth is a later plan). Now
// is injectable for deterministic tests.
type Options struct {
	IdleTimeout time.Duration
	RowerID     string
	RowerName   string
	Now         func() time.Time
	// StartID seeds the monotonic id counter. The first emitted event
	// receives StartID+1. Use to resume across process restarts so
	// stroke global_id stays unique (max(global_id) from storage).
	StartID uint64
}

// Sessionizer is the pipeline stage that turns a stream of ipm.Frame
// into a stream of event.Event with synthesised session boundaries,
// Tier-2 enrichment, and lifetime-monotonic ids.
type Sessionizer struct {
	opts    Options
	nextID  uint64
	session *sessionState
}

type sessionState struct {
	id            string
	startedAt     time.Time
	strokes       int
	totalDistance int
	totalTime     float64
	powerSum      int
	peakPower     int
	spmSum        int
	dpsSum        float64
	paceSum       int
	calSum        int
	lastStroke    *event.StrokePayload
	lastSeen      time.Time
	lastLevel     int
}

func New(o Options) *Sessionizer {
	if o.Now == nil {
		o.Now = time.Now
	}
	return &Sessionizer{opts: o, nextID: o.StartID}
}

func (s *Sessionizer) stamp(e *event.Event) {
	s.nextID++
	e.ID = s.nextID
	if e.At.IsZero() {
		e.At = s.opts.Now()
	}
}

func (s *Sessionizer) emit(ctx context.Context, out chan<- event.Event, e event.Event) error {
	s.stamp(&e)
	select {
	case out <- e:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Run drains frames until ctx is done or in is closed. When in closes
// cleanly and a session is still open, Run synthesises a final
// session_end so consumers see a closed session.
func (s *Sessionizer) Run(ctx context.Context, in <-chan ipm.Frame, out chan<- event.Event) error {
	defer close(out)
	for {
		select {
		case <-ctx.Done():
			s.closeIfOpen(ctx, out)
			return ctx.Err()
		case f, ok := <-in:
			if !ok {
				s.closeIfOpen(ctx, out)
				return nil
			}
			if err := s.onFrame(ctx, f, out); err != nil {
				return err
			}
		}
	}
}

func (s *Sessionizer) onFrame(ctx context.Context, f ipm.Frame, out chan<- event.Event) error {
	now := s.opts.Now()

	if s.session != nil && now.Sub(s.session.lastSeen) >= s.opts.IdleTimeout {
		if err := s.closeSession(ctx, out); err != nil {
			return err
		}
	}
	if s.session == nil {
		if err := s.openSession(ctx, out, f); err != nil {
			return err
		}
	}

	stroke := s.enrich(f)
	if err := s.emit(ctx, out, event.Event{
		Kind:      event.KindStroke,
		SessionID: s.session.id,
		Stroke:    &stroke,
	}); err != nil {
		return err
	}
	s.accumulate(&stroke)

	if s.session.lastLevel != 0 && stroke.Level != s.session.lastLevel {
		if err := s.emit(ctx, out, event.Event{
			Kind:      event.KindLevelChange,
			SessionID: s.session.id,
			LevelChange: &event.LevelChangePayload{
				From: s.session.lastLevel, To: stroke.Level,
				AtStroke: stroke.StrokeNo, AtTimeSec: stroke.TimeSec,
			},
		}); err != nil {
			return err
		}
	}
	s.session.lastLevel = stroke.Level
	s.session.lastSeen = now
	return nil
}

func (s *Sessionizer) enrich(f ipm.Frame) event.StrokePayload {
	p := event.StrokePayload{
		StrokeNo:   s.session.strokes + 1,
		TimeSec:    f.TimeSec,
		DistanceM:  f.DistanceM,
		SPM:        f.SPM,
		PowerW:     f.PowerW,
		CalPerHr:   f.CalPerHr,
		Level:      f.Level,
		RawPayload: f.RawPayload,
	}
	if s.session.lastStroke == nil {
		p.DPS = DPSFirst()
		p.StrokeCycleSec = 0
		p.PaceSecPer500m = 0
		p.EnergyJoules = 0
	} else {
		p.DPS = DPS(s.session.lastStroke.DistanceM, f.DistanceM, 0)
		p.StrokeCycleSec = StrokeCycleSec(s.session.lastStroke.TimeSec, f.TimeSec)
		p.PaceSecPer500m = PaceSecPer500m(p.DPS, p.StrokeCycleSec)
		p.EnergyJoules = EnergyJoules(f.PowerW, p.StrokeCycleSec)
	}
	return p
}

func (s *Sessionizer) accumulate(p *event.StrokePayload) {
	s.session.strokes++
	s.session.totalDistance = p.DistanceM
	s.session.totalTime = p.TimeSec
	s.session.powerSum += p.PowerW
	if p.PowerW > s.session.peakPower {
		s.session.peakPower = p.PowerW
	}
	s.session.spmSum += p.SPM
	s.session.dpsSum += p.DPS
	s.session.paceSum += p.PaceSecPer500m
	s.session.calSum += p.EnergyJoules
	p2 := *p
	s.session.lastStroke = &p2
}

func (s *Sessionizer) openSession(ctx context.Context, out chan<- event.Event, f ipm.Frame) error {
	id := ulid.Make().String()
	now := s.opts.Now()
	s.session = &sessionState{
		id:        id,
		startedAt: now,
		lastSeen:  now,
	}
	return s.emit(ctx, out, event.Event{
		Kind:      event.KindSessionStart,
		SessionID: id,
		SessionStart: &event.SessionStartPayload{
			StartedAt:    now,
			RowerID:      s.opts.RowerID,
			RowerName:    s.opts.RowerName,
			InitialLevel: f.Level,
		},
	})
}

func (s *Sessionizer) closeSession(ctx context.Context, out chan<- event.Event) error {
	st := s.session
	s.session = nil
	summary := event.SessionSummary{
		TotalDistanceM: st.totalDistance,
		TotalTimeSec:   st.totalTime,
		TotalStrokes:   st.strokes,
		PeakPowerW:     st.peakPower,
	}
	if st.strokes > 0 {
		summary.AvgPowerW = st.powerSum / st.strokes
		summary.AvgSPM = float64(st.spmSum) / float64(st.strokes)
		summary.AvgDPS = st.dpsSum / float64(st.strokes)
		summary.AvgPaceSecPer500m = st.paceSum / st.strokes
		summary.SessionCalories = st.calSum / 1000 // joules → kcal
	}
	return s.emit(ctx, out, event.Event{
		Kind:      event.KindSessionEnd,
		SessionID: st.id,
		SessionEnd: &event.SessionEndPayload{
			EndedAt: s.opts.Now(),
			Summary: summary,
		},
	})
}

func (s *Sessionizer) closeIfOpen(ctx context.Context, out chan<- event.Event) {
	if s.session == nil {
		return
	}
	_ = s.closeSession(ctx, out)
}
