package session

import (
	"context"
	"sync"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/ipm"
	"github.com/gloeckner-daniel/splits/internal/workout"
	"github.com/oklog/ulid/v2"
)

// Options configures a Sessionizer. IdleTimeout controls the gap
// between stroke frames that closes a session. RowerID/RowerName are
// stubbed attribution per ARCH-0001 (real auth is a later plan). Now
// is injectable for deterministic tests.
type Options struct {
	IdleTimeout time.Duration
	// InactivityTimeout closes a session when frames keep arriving but
	// distance has not advanced for this long — e.g. ergo idle-broadcast
	// or a fixture replay with the user not actually rowing. Zero
	// disables the check.
	InactivityTimeout time.Duration
	// ResolveRower returns the rower to attribute new sessions to at
	// the moment a session opens. If nil, falls back to RowerID/Name.
	ResolveRower func() (id, name string)
	RowerID      string
	RowerName    string
	Now          func() time.Time
	// StartID seeds the monotonic id counter. The first emitted event
	// receives StartID+1. Use to resume across process restarts so
	// stroke global_id stays unique (max(global_id) from storage).
	StartID uint64
	// LoadWorkout fetches a workout by ID so the sessionizer can build a
	// PhasePlan when a session opens. If nil, every session is treated as
	// a free-row (all strokes are PhaseWork).
	LoadWorkout func(id string) (*workout.Workout, error)
}

// Sessionizer is the pipeline stage that turns a stream of ipm.Frame
// into a stream of event.Event with synthesised session boundaries,
// Tier-2 enrichment, and lifetime-monotonic ids.
type Sessionizer struct {
	opts             Options
	nextID           uint64
	session          *sessionState
	mu               sync.Mutex
	pendingWorkoutID string
	attachC          chan string
	// endC carries explicit end requests (POST /api/v1/session/end).
	// Buffered so the HTTP handler doesn't block.
	endC chan struct{}
	// startC carries explicit start requests (POST /api/v1/session/start)
	// with the workout id (or "" for a free row). Buffered so the HTTP
	// handler doesn't block.
	startC chan string
	// Snapshot of the currently open session so reconnecting SSE clients
	// whose `Last-Event-ID` is past these events can still learn the
	// current session state. Cleared on closeSession.
	currentSessionStart    *event.Event
	currentWorkoutAttached *event.Event
	currentPhaseChange     *event.Event
}

type sessionState struct {
	id            string
	startedAt     time.Time
	// strokeSeq counts every stroke (all phases) for StrokeNo assignment.
	strokeSeq     int
	// strokes counts work-phase strokes only (used for summary averages).
	strokes       int
	totalDistance int
	totalTime     float64
	powerSum      int
	peakPower     int
	spmSum        int
	dpsSum        float64
	spiSum        int
	spiCount      int
	paceSum       int
	calSum        int
	lastStroke    *event.StrokePayload
	lastSeen      time.Time
	// lastActivity is the wall-clock time of the last frame that made
	// real progress (distance increased). Used by InactivityTimeout to
	// close sessions where frames keep flowing but the user isn't
	// actually rowing.
	lastActivity  time.Time
	lastLevel     int
	plan          *PhasePlan
	currentPhase  Phase
	warmupSec     float64
	restSec       float64
	cooldownSec   float64
	phaseLastTime float64
	// Anchors rebase PM5 cumulative values to session-relative.
	// storage anchor is captured at the first stroke and never moves;
	// every persisted/emitted stroke has its DistanceM/TimeSec rebased
	// against it. phase anchor drives PhasePlan.Classify and resets on
	// workout_attached so a mid-session attach gets a fresh warmup.
	storageAnchorSet      bool
	storageAnchorDistance int
	storageAnchorTimeSec  float64
	phaseAnchorSet        bool
	phaseAnchorDistance   int
	phaseAnchorTimeSec    float64
	// recentStrokes is a small ring buffer of the most recent strokes
	// used by LivePace for the windowed split. Trimmed to entries whose
	// TimeSec is within the active window of the latest stroke (plus
	// one bracketing stroke before the window so the leading edge can
	// be interpolated). See ADR-0011.
	recentStrokes []event.StrokePayload
	// lastLivePace is the last computed windowed pace value (Kind ==
	// LivePaceValue). When LivePace returns LivePaceHeld, the
	// sessionizer re-emits this value on the wire so the frontend tile
	// holds steady through a slow recovery.
	lastLivePace int
}

func New(o Options) *Sessionizer {
	if o.Now == nil {
		o.Now = time.Now
	}
	return &Sessionizer{
		opts: o, nextID: o.StartID,
		attachC: make(chan string, 8),
		endC:    make(chan struct{}, 4),
		startC:  make(chan string, 4),
	}
}

func (s *Sessionizer) stamp(e *event.Event) {
	s.mu.Lock()
	s.nextID++
	e.ID = s.nextID
	s.mu.Unlock()
	if e.At.IsZero() {
		e.At = s.opts.Now()
	}
}

// Stamp exposes the sessionizer's monotonic ID + At allocator to
// downstream stages (currently the persister, for its post-commit
// session_finalized emission per PRD-0017). The lifetime-monotonic
// invariant on Event.ID is preserved: all emissions — sessionizer-led
// or persister-led — draw from the same counter under s.mu.
func (s *Sessionizer) Stamp(e *event.Event) {
	s.stamp(e)
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
		case id := <-s.attachC:
			if err := s.handleAttach(ctx, id, out); err != nil {
				return err
			}
		case <-s.endC:
			if s.session != nil {
				if err := s.closeSession(ctx, out); err != nil {
					return err
				}
			}
		case wid := <-s.startC:
			if s.session != nil {
				// If the open session has been idle past IdleTimeout,
				// close it first so the new start opens a fresh
				// session. Otherwise a duplicate start is a no-op
				// (idempotent).
				now := s.opts.Now()
				if now.Sub(s.session.lastSeen) < s.opts.IdleTimeout {
					continue
				}
				if err := s.closeSession(ctx, out); err != nil {
					return err
				}
			}
			// Only overwrite the pending workout if the caller
			// supplied one. AttachWorkout-then-StartSession("") is
			// a valid sequence; the prior AttachWorkout id wins.
			if wid != "" {
				s.mu.Lock()
				s.pendingWorkoutID = wid
				s.mu.Unlock()
			}
			if err := s.openSessionPending(ctx, out); err != nil {
				return err
			}
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

// handleAttach is invoked by Run when AttachWorkout delivers an id via
// attachC. If a session is open, emits a workout_attached event and
// clears pendingWorkoutID so the next session open doesn't re-carry
// the same workout. If no session is open, leaves pendingWorkoutID set
// by AttachWorkout untouched (next openSession will consume it).
func (s *Sessionizer) handleAttach(ctx context.Context, id string, out chan<- event.Event) error {
	if s.session == nil {
		return nil
	}
	s.mu.Lock()
	s.pendingWorkoutID = ""
	s.mu.Unlock()
	// Rebuild the phase plan against the freshly attached workout, and
	// drop the phase anchor so the next stroke captures a new origin.
	if s.opts.LoadWorkout != nil && id != "" {
		if w, err := s.opts.LoadWorkout(id); err == nil && w != nil {
			if pp, perr := BuildPhasePlan(w); perr == nil {
				s.session.plan = pp
			}
		}
	}
	s.session.phaseAnchorSet = false
	s.session.currentPhase = PhaseWork
	s.session.phaseLastTime = 0
	s.mu.Lock()
	s.currentPhaseChange = nil
	s.mu.Unlock()
	e := event.Event{
		Kind:            event.KindWorkoutAttached,
		SessionID:       s.session.id,
		WorkoutAttached: &event.WorkoutAttachedPayload{WorkoutID: id},
	}
	s.stamp(&e)
	s.mu.Lock()
	snap := e
	s.currentWorkoutAttached = &snap
	s.mu.Unlock()
	select {
	case out <- e:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Sessionizer) onFrame(ctx context.Context, f ipm.Frame, out chan<- event.Event) error {
	now := s.opts.Now()

	if s.session != nil && now.Sub(s.session.lastSeen) >= s.opts.IdleTimeout {
		if err := s.closeSession(ctx, out); err != nil {
			return err
		}
	}
	if s.session != nil && s.opts.InactivityTimeout > 0 &&
		now.Sub(s.session.lastActivity) >= s.opts.InactivityTimeout {
		if err := s.closeSession(ctx, out); err != nil {
			return err
		}
	}
	if s.session == nil {
		// No active session — drain a pending Start request first
		// (handler / sessionizer caller may have raced with the
		// frame), otherwise drop the stroke silently. This keeps
		// fixture replays and idle-handle pulls from creating
		// spurious sessions while still letting StartSession +
		// frame in either order work.
		select {
		case wid := <-s.startC:
			if wid != "" {
				s.mu.Lock()
				s.pendingWorkoutID = wid
				s.mu.Unlock()
			}
			if err := s.openSessionPending(ctx, out); err != nil {
				return err
			}
		default:
			return nil
		}
	}

	// Capture absolute (PM5-cumulative) values before rebasing; they are
	// needed when re-anchoring on workout_attached.
	absDist, absTime := f.DistanceM, f.TimeSec
	if !s.session.storageAnchorSet {
		s.session.storageAnchorSet = true
		s.session.storageAnchorDistance = absDist
		s.session.storageAnchorTimeSec = absTime
	}
	if !s.session.phaseAnchorSet {
		s.session.phaseAnchorSet = true
		s.session.phaseAnchorDistance = absDist
		s.session.phaseAnchorTimeSec = absTime
		if s.session.plan != nil {
			s.session.plan.Reset()
		}
	}
	// Rebase the frame in place so every downstream consumer sees
	// session-relative values from t=0.
	f.DistanceM -= s.session.storageAnchorDistance
	f.TimeSec -= s.session.storageAnchorTimeSec

	stroke := s.enrich(f)

	// Phase plan operates on phase-anchor-relative values, which differ
	// from storage-relative when the workout was attached mid-session.
	phaseOffsetDist := s.session.phaseAnchorDistance - s.session.storageAnchorDistance
	phaseOffsetTime := s.session.phaseAnchorTimeSec - s.session.storageAnchorTimeSec
	phase, complete := s.session.plan.Classify(stroke.DistanceM-phaseOffsetDist, stroke.TimeSec-phaseOffsetTime)
	stroke.Phase = phase.String()
	if phase != s.session.currentPhase {
		dt := stroke.TimeSec - s.session.phaseLastTime
		switch s.session.currentPhase {
		case PhaseWarmup:
			s.session.warmupSec += dt
		case PhaseRest:
			s.session.restSec += dt
		case PhaseCooldown:
			s.session.cooldownSec += dt
		}
		pc := event.Event{
			Kind:      event.KindPhaseChange,
			SessionID: s.session.id,
			PhaseChange: &event.PhaseChangePayload{
				From:        s.session.currentPhase.String(),
				To:          phase.String(),
				AtStroke:    stroke.StrokeNo,
				AtTimeSec:   stroke.TimeSec,
				AtDistanceM: stroke.DistanceM,
			},
		}
		s.stamp(&pc)
		s.mu.Lock()
		snap := pc
		s.currentPhaseChange = &snap
		s.mu.Unlock()
		select {
		case out <- pc:
		case <-ctx.Done():
			return ctx.Err()
		}
		s.session.currentPhase = phase
		s.session.phaseLastTime = stroke.TimeSec
	}

	if err := s.emit(ctx, out, event.Event{
		Kind:      event.KindStroke,
		SessionID: s.session.id,
		Stroke:    &stroke,
	}); err != nil {
		return err
	}
	// Capture the previous-stroke distance BEFORE accumulate, since
	// accumulate overwrites s.session.lastStroke with the current
	// stroke (so the post-accumulate comparison would always be
	// equal and lastActivity would freeze at the first stroke,
	// causing a spurious inactivity-timeout close).
	prevDistance := -1
	hadPrev := s.session.lastStroke != nil
	if hadPrev {
		prevDistance = s.session.lastStroke.DistanceM
	}
	if phase == PhaseWork {
		s.accumulate(&stroke)
	} else {
		// Still need lastStroke updated for inactivity / DPS enrichment,
		// but don't count this stroke in session totals.
		p2 := stroke
		s.session.lastStroke = &p2
	}

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
	// A frame counts as "activity" only if distance advanced. Idle
	// broadcasts (same DistanceM repeated) leave lastActivity untouched
	// so InactivityTimeout can fire.
	if hadPrev && prevDistance != stroke.DistanceM {
		s.session.lastActivity = now
	} else if s.session.strokeSeq == 1 {
		// First stroke: seed activity timer so a brand-new session
		// doesn't immediately trigger inactivity.
		s.session.lastActivity = now
	}
	if complete {
		return s.closeSession(ctx, out)
	}
	return nil
}

func (s *Sessionizer) enrich(f ipm.Frame) event.StrokePayload {
	s.session.strokeSeq++
	p := event.StrokePayload{
		StrokeNo:   s.session.strokeSeq,
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
		p.EnergyJoules = EnergyJoules(f.PowerW, p.StrokeCycleSec)
	}

	// Windowed live split (ADR-0011 / FEAT-0015 Slice 5). The wire field
	// pace_sec_per_500m carries the windowed result, not the per-stroke
	// extrapolation. Append the current stroke to the recent-stroke ring
	// buffer (trimmed to the active window plus one bracketing stroke),
	// then evaluate.
	s.session.recentStrokes = appendAndTrimWindow(s.session.recentStrokes, p, LivePaceWindowSec)
	pace, kind := LivePace(s.session.recentStrokes, LivePaceWindowSec, p.TimeSec)
	switch kind {
	case LivePaceValue:
		s.session.lastLivePace = pace
		p.PaceSecPer500m = pace
	case LivePaceHeld:
		p.PaceSecPer500m = s.session.lastLivePace
	case LivePaceEmpty:
		p.PaceSecPer500m = 0
	}
	return p
}

// appendAndTrimWindow appends p to buf and drops leading entries that
// fall outside the current window (plus one bracketing stroke before
// the window edge — needed so LivePace can interpolate the leading
// edge). Keeps the buffer small (O(strokes-per-window), typically <10).
func appendAndTrimWindow(buf []event.StrokePayload, p event.StrokePayload, windowSec float64) []event.StrokePayload {
	buf = append(buf, p)
	cutoff := p.TimeSec - windowSec
	// Find the largest index i such that buf[i].TimeSec < cutoff — that
	// stroke is the one bracketing stroke we keep so distAt() can
	// interpolate the leading edge. Drop everything before it.
	bracket := -1
	for i, s := range buf {
		if s.TimeSec < cutoff {
			bracket = i
		} else {
			break
		}
	}
	if bracket > 0 {
		buf = append(buf[:0], buf[bracket:]...)
	}
	return buf
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
	if p.SPM > 0 && p.PowerW >= 20 {
		s.session.spiSum += p.PowerW / p.SPM
		s.session.spiCount++
	}
	s.session.paceSum += p.PaceSecPer500m
	s.session.calSum += p.EnergyJoules
	p2 := *p
	s.session.lastStroke = &p2
}

func (s *Sessionizer) openSession(ctx context.Context, out chan<- event.Event, f ipm.Frame) error {
	return s.openSessionInternal(ctx, out, f.Level)
}

// openSessionPending opens a session triggered by an explicit Start
// request (no frame yet). Initial level defaults to 0 and is updated
// by the first incoming stroke.
func (s *Sessionizer) openSessionPending(ctx context.Context, out chan<- event.Event) error {
	return s.openSessionInternal(ctx, out, 0)
}

func (s *Sessionizer) openSessionInternal(ctx context.Context, out chan<- event.Event, initialLevel int) error {
	id := ulid.Make().String()
	now := s.opts.Now()
	s.session = &sessionState{
		id:           id,
		startedAt:    now,
		lastSeen:     now,
		lastActivity: now,
	}
	rid, rname := s.resolveRower()
	s.mu.Lock()
	workoutID := s.pendingWorkoutID
	s.pendingWorkoutID = ""
	s.mu.Unlock()

	plan := FreeRowPhasePlan()
	if s.opts.LoadWorkout != nil && workoutID != "" {
		if w, err := s.opts.LoadWorkout(workoutID); err == nil && w != nil {
			if pp, perr := BuildPhasePlan(w); perr == nil {
				plan = pp
			}
		}
	}
	s.session.plan = plan
	s.session.currentPhase = PhaseWork
	e := event.Event{
		Kind:      event.KindSessionStart,
		SessionID: id,
		SessionStart: &event.SessionStartPayload{
			StartedAt:    now,
			RowerID:      rid,
			RowerName:    rname,
			InitialLevel: initialLevel,
			WorkoutID:    workoutID,
		},
	}
	s.stamp(&e)
	s.mu.Lock()
	snap := e
	s.currentSessionStart = &snap
	s.currentWorkoutAttached = nil
	s.currentPhaseChange = nil
	s.mu.Unlock()
	select {
	case out <- e:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// AttachWorkout tags the currently open session with the given workout
// ID (emitting a workout_attached event via Run) and, if no session is
// open yet, primes the next session open to carry it. The two effects
// are compatible: Run's handleAttach clears the pending slot when it
// emits the mid-session event, so the same workout isn't re-applied to
// a subsequent session.
// ActiveSessionID returns the id of the currently open session, or
// "" when none is open. Used by the sessions API to reject DELETE of
// a session that is still being broadcast (a delete during live
// recording would race the sessionizer's own writes).
func (s *Sessionizer) ActiveSessionID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.currentSessionStart == nil {
		return ""
	}
	return s.currentSessionStart.SessionID
}

// MaxEventID returns the highest event id this sessionizer has
// stamped so far. Used by the SSE handler to detect a stale client
// cursor (Last-Event-ID from a prior backend run that emitted larger
// ids) and fall back to "stream from now" instead of silently
// filtering everything new.
func (s *Sessionizer) MaxEventID() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nextID
}

// StartSession requests an immediate open of a new session, attached
// to the given workout id (empty for "just row"). Safe to call from
// any goroutine. No-op if a session is already open. Idempotent.
func (s *Sessionizer) StartSession(workoutID string) {
	select {
	case s.startC <- workoutID:
	default:
		// Channel full: a start request is already queued, drop.
	}
}

// EndSession requests an immediate close of the currently open session
// (if any). Safe to call from any goroutine. No-op if no session open.
func (s *Sessionizer) EndSession() {
	select {
	case s.endC <- struct{}{}:
	default:
		// Channel full: a close request is already queued; dropping
		// extras is fine since they're idempotent.
	}
}

func (s *Sessionizer) AttachWorkout(id string) {
	s.mu.Lock()
	s.pendingWorkoutID = id
	s.mu.Unlock()
	select {
	case s.attachC <- id:
	default:
		// Channel full: Run hasn't drained prior attaches. The
		// pendingWorkoutID already carries the latest id for next
		// session open; dropping the channel send means a mid-session
		// event may be skipped, which is acceptable degradation.
	}
}

func (s *Sessionizer) resolveRower() (string, string) {
	if s.opts.ResolveRower != nil {
		return s.opts.ResolveRower()
	}
	return s.opts.RowerID, s.opts.RowerName
}

func (s *Sessionizer) closeSession(ctx context.Context, out chan<- event.Event) error {
	st := s.session
	s.session = nil

	// Credit the trailing phase slice (time from last boundary to last stroke).
	if st.lastStroke != nil {
		dt := st.lastStroke.TimeSec - st.phaseLastTime
		switch st.currentPhase {
		case PhaseWarmup:
			st.warmupSec += dt
		case PhaseRest:
			st.restSec += dt
		case PhaseCooldown:
			st.cooldownSec += dt
		}
	}

	summary := event.SessionSummary{
		TotalDistanceM: st.totalDistance,
		TotalTimeSec:   st.totalTime,
		TotalStrokes:   st.strokes,
		PeakPowerW:     st.peakPower,
		WarmupSec:      st.warmupSec,
		RestSec:        st.restSec,
		CooldownSec:    st.cooldownSec,
	}
	if st.strokes > 0 {
		summary.AvgPowerW = st.powerSum / st.strokes
		summary.AvgSPM = float64(st.spmSum) / float64(st.strokes)
		summary.AvgDPS = st.dpsSum / float64(st.strokes)
		summary.AvgPaceSecPer500m = st.paceSum / st.strokes
		summary.SessionCalories = st.calSum / 1000 // joules → kcal
		if st.spiCount > 0 {
			summary.AvgSPI = st.spiSum / st.spiCount
		}
	}
	s.mu.Lock()
	s.currentSessionStart = nil
	s.currentWorkoutAttached = nil
	s.currentPhaseChange = nil
	s.mu.Unlock()
	return s.emit(ctx, out, event.Event{
		Kind:      event.KindSessionEnd,
		SessionID: st.id,
		SessionEnd: &event.SessionEndPayload{
			EndedAt: s.opts.Now(),
			Summary: summary,
		},
	})
}

// Snapshot returns a slice of synthetic "current state" events (the
// currently open session's session_start, and its latest
// workout_attached if any). Used by the SSE handler to bring
// reconnecting clients up to date when their cursor is past these
// events.
func (s *Sessionizer) Snapshot() []event.Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []event.Event
	if s.currentSessionStart != nil {
		out = append(out, *s.currentSessionStart)
	}
	if s.currentWorkoutAttached != nil {
		out = append(out, *s.currentWorkoutAttached)
	}
	if s.currentPhaseChange != nil {
		out = append(out, *s.currentPhaseChange)
	}
	return out
}

func (s *Sessionizer) closeIfOpen(ctx context.Context, out chan<- event.Event) {
	if s.session == nil {
		return
	}
	_ = s.closeSession(ctx, out)
}
