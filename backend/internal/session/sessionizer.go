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
	// PauseTimeout: distance frozen (or no frames) for this long puts
	// the open session into Paused (CONTEXT.md §Pause / Abort) instead
	// of closing it. Zero disables pause detection (legacy tests).
	PauseTimeout time.Duration
	// ResumeWindow: a session continuously paused for this long is
	// closed for good. The stale-open threshold must not undercut it.
	// When zero, IdleTimeout is used as the close threshold instead.
	ResumeWindow time.Duration
	// InactivityTimeout is kept for backwards compatibility with callers
	// that have not yet migrated to PauseTimeout. When PauseTimeout is
	// zero and InactivityTimeout is non-zero, the old close-on-inactivity
	// behaviour is preserved. Deprecated: prefer PauseTimeout.
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
	// LivenessChecker validates the in-memory `currentSessionStart` cache
	// against the persisted row. Used at entry points (Snapshot,
	// StartSession) to drop a stale cache when the DB says the session
	// is ended / stale-open / missing. May be nil in tests; without it,
	// the sessionizer trusts its in-memory state (legacy behaviour).
	LivenessChecker SessionLivenessChecker
	// NewSessionID overrides session-id generation. Defaults to
	// ulid.Make().String(). The golden harness (ADR-0017) injects a
	// deterministic counter so golden JSONL is byte-stable run-to-run.
	NewSessionID func() string
}

// SessionStatus is the DB-side verdict on whether a cached
// currentSessionStart is still authoritative.
type SessionStatus int

const (
	// SessionStatusUnknown means the checker could not determine the
	// status (DB error, no checker wired). Treat as "trust the cache".
	SessionStatusUnknown SessionStatus = iota
	// SessionStatusLive: row exists, ended_at IS NULL, status='open'.
	// The cache is authoritative.
	SessionStatusLive
	// SessionStatusStaleOpen: row exists, status='stale-open'. The
	// session is dead in the database (idle > threshold); the
	// in-memory cache must be cleared.
	SessionStatusStaleOpen
	// SessionStatusEnded: row exists, ended_at IS NOT NULL.
	SessionStatusEnded
	// SessionStatusMissing: no row with this id.
	SessionStatusMissing
)

// SessionLivenessChecker reports whether a cached session id is still
// authoritative according to the database. See SessionStatus.
type SessionLivenessChecker interface {
	CheckSessionLiveness(ctx context.Context, id string) SessionStatus
}

// accumulator holds the work-phase counters that feed the session
// summary. Extracted from sessionState so it can be zero-valued as a
// struct (F3 resets it cleanly with acc = accumulator{}).
type accumulator struct {
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
	// currentSessionPaused is non-nil while the session is in the
	// Paused sub-state. Included in Snapshot() so reconnecting clients
	// know the session is paused. Cleared on resume/close/ClearActiveSession.
	currentSessionPaused *event.Event
}

type sessionState struct {
	id        string
	startedAt time.Time
	// strokeSeq counts every stroke (all phases) for StrokeNo assignment.
	strokeSeq  int
	acc        accumulator
	lastStroke *event.StrokePayload
	lastSeen   time.Time
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
	// workAnchor is the (distance, time) of the first work-phase stroke,
	// captured once (workAnchorSet=true) and never moved. The session
	// summary's TotalDistanceM / TotalTimeSec are the *deltas* from this
	// anchor to the last work stroke, so warmup distance/time that
	// climbed the PM5 cumulative counters never leak into work totals
	// (CONTEXT.md §Workout phases: "Only Work-phase strokes count").
	workAnchorSet      bool
	workAnchorDistance int
	workAnchorTimeSec  float64
	// Pause sub-state (CONTEXT.md §Pause / Abort).
	pausedSinceWall time.Time // zero when not paused
	pausedAtWorkSec float64   // work-clock TimeSec of last stroke before pause
	pausedAccumSec  float64   // total device-time excluded from work clock

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
	if o.NewSessionID == nil {
		o.NewSessionID = func() string { return ulid.Make().String() }
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

// appendEvent stamps e and appends it to evs, returning the extended slice.
func (s *Sessionizer) appendEvent(evs []event.Event, e event.Event) []event.Event {
	s.stamp(&e)
	return append(evs, e)
}

// forward sends each event in evs to out, returning an error if ctx is cancelled.
func forward(ctx context.Context, out chan<- event.Event, evs []event.Event) error {
	for _, e := range evs {
		select {
		case out <- e:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

// Run drains frames until ctx is done or in is closed. When in closes
// cleanly and a session is still open, Run synthesises a final
// session_end so consumers see a closed session.
//
// A 1-second ticker fires while a paused session is open so that
// ResumeWindow expiry is detected even when the frame source has gone
// completely silent (e.g. ergo powered off, or FixtureProducer paused
// mid-stream in E2E tests). Without the ticker the check only fires
// inside onFrame; a truly silent device would never trigger a close.
func (s *Sessionizer) Run(ctx context.Context, in <-chan ipm.Frame, out chan<- event.Event) error {
	defer close(out)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = forward(ctx, out, s.closeIfOpenSync())
			return ctx.Err()
		case id := <-s.attachC:
			if err := forward(ctx, out, s.handleAttach(id)); err != nil {
				return err
			}
		case <-s.endC:
			if s.session != nil {
				if err := forward(ctx, out, s.closeSession()); err != nil {
					return err
				}
			}
		case wid := <-s.startC:
			// Single-source-of-truth: before deciding "session already
			// open, ignore start", confirm with the DB. If the row is
			// stale-open/ended/missing the in-memory cache is the loser;
			// clearing it lets the caller open a fresh session
			// immediately instead of being silently dropped during the
			// drift window between "frames stopped" and the janitor
			// sweep that flips the row.
			s.dropDeadSessionOnStart(ctx)
			if s.session != nil {
				// Policy (e): a paused session must not block an explicit
				// Start. Close it so the new session opens immediately.
				if !s.session.pausedSinceWall.IsZero() {
					if err := forward(ctx, out, s.closeSession()); err != nil {
						return err
					}
				} else {
					// If the open session has been idle past IdleTimeout,
					// close it first so the new start opens a fresh
					// session. Otherwise a duplicate start is a no-op
					// (idempotent).
					now := s.opts.Now()
					if now.Sub(s.session.lastSeen) < s.opts.IdleTimeout {
						continue
					}
					if err := forward(ctx, out, s.closeSession()); err != nil {
						return err
					}
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
			if err := forward(ctx, out, s.openSessionPending()); err != nil {
				return err
			}
		case f, ok := <-in:
			if !ok {
				return forward(ctx, out, s.closeIfOpenSync())
			}
			if err := forward(ctx, out, s.onFrame(f)); err != nil {
				return err
			}
		case <-tick.C:
			// Periodic check fired when no frames are arriving (e.g.
			// the ergo is silent or the fixture is paused mid-stream).
			// Two responsibilities:
			//   1. If a session is already paused and ResumeWindow has
			//      elapsed, force-close it.
			//   2. If a session is open, PauseTimeout > 0, and we
			//      haven't seen lastActivity advance for >= PauseTimeout,
			//      enter the Paused sub-state (same logic as onFrame but
			//      driven by wall-clock when frames stop arriving).
			if s.opts.PauseTimeout <= 0 || s.session == nil {
				break
			}
			now := s.opts.Now()
			if !s.session.pausedSinceWall.IsZero() {
				// Already paused — check ResumeWindow.
				resumeWindow := s.opts.ResumeWindow
				if resumeWindow <= 0 {
					resumeWindow = s.opts.IdleTimeout
				}
				if now.Sub(s.session.pausedSinceWall) >= resumeWindow {
					if err := forward(ctx, out, s.closeSession()); err != nil {
						return err
					}
				}
			} else if !s.session.lastActivity.IsZero() &&
				now.Sub(s.session.lastActivity) >= s.opts.PauseTimeout &&
				s.session.currentPhase != PhaseCooldown {
				// Not yet paused, but activity has been silent for
				// PauseTimeout. Enter the Paused sub-state.
				if err := forward(ctx, out, s.enterPause(now)); err != nil {
					return err
				}
			}
		}
	}
}

// handleAttach is invoked by Run when AttachWorkout delivers an id via
// attachC. If a session is open, emits a workout_attached event and
// clears pendingWorkoutID so the next session open doesn't re-carry
// the same workout. If no session is open, leaves pendingWorkoutID set
// by AttachWorkout untouched (next openSession will consume it).
func (s *Sessionizer) handleAttach(id string) []event.Event {
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
	return []event.Event{e}
}

// enterPause transitions the open session into the Paused sub-state and
// returns a session_paused event. Policy (b): never arm during cooldown.
func (s *Sessionizer) enterPause(now time.Time) []event.Event {
	st := s.session
	if st == nil {
		return nil
	}
	// Policy (b): never arm pause during cooldown
	if st.currentPhase == PhaseCooldown {
		return nil
	}
	st.pausedSinceWall = now
	if st.lastStroke != nil {
		st.pausedAtWorkSec = st.lastStroke.TimeSec
	}
	e := event.Event{
		Kind:         event.KindSessionPaused,
		SessionID:    st.id,
		SessionPause: &event.SessionPausePayload{AtTimeSec: st.pausedAtWorkSec},
	}
	s.mu.Lock()
	snap := e
	s.currentSessionPaused = &snap
	s.mu.Unlock()
	return s.appendEvent(nil, e)
}

func (s *Sessionizer) onFrame(f ipm.Frame) []event.Event {
	var evs []event.Event
	now := s.opts.Now()

	if s.session != nil {
		// Determine the effective close threshold.
		// When PauseTimeout is set, a paused session is closed only after
		// ResumeWindow (or IdleTimeout as fallback). A session that was
		// never paused uses IdleTimeout.
		closeThreshold := s.opts.IdleTimeout
		if s.opts.PauseTimeout > 0 {
			if !s.session.pausedSinceWall.IsZero() {
				// Session is paused; use ResumeWindow as the close threshold.
				resumeWindow := s.opts.ResumeWindow
				if resumeWindow <= 0 {
					resumeWindow = s.opts.IdleTimeout
				}
				if now.Sub(s.session.pausedSinceWall) >= resumeWindow {
					evs = append(evs, s.closeSession()...)
				}
			} else {
				if now.Sub(s.session.lastSeen) >= closeThreshold {
					evs = append(evs, s.closeSession()...)
				}
			}
		} else {
			// Legacy: no PauseTimeout. Use IdleTimeout + InactivityTimeout.
			if now.Sub(s.session.lastSeen) >= s.opts.IdleTimeout {
				evs = append(evs, s.closeSession()...)
			}
			if s.session != nil && s.opts.InactivityTimeout > 0 &&
				now.Sub(s.session.lastActivity) >= s.opts.InactivityTimeout {
				evs = append(evs, s.closeSession()...)
			}
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
			evs = append(evs, s.openSessionPending()...)
		default:
			return evs
		}
	}

	// ---- Idle-frame detection ----
	// An idle frame has the same (or lower) distance as the last stroke.
	// Policy (a): idle frames update lastSeen but do NOT create stroke events.
	prevDist := -1
	if s.session.lastStroke != nil {
		prevDist = s.session.lastStroke.DistanceM
	}
	// Rebase the incoming distance for comparison. Anchors may not be set yet
	// on the very first frame; treat pre-anchor frames as non-idle.
	rebasedDist := f.DistanceM
	if s.session.storageAnchorSet {
		rebasedDist = f.DistanceM - s.session.storageAnchorDistance
	}
	// Idle detection only applies when PauseTimeout is enabled. Legacy
	// callers (PauseTimeout=0) keep the old behaviour where every frame
	// produces a stroke event.
	isIdle := s.opts.PauseTimeout > 0 &&
		s.session.storageAnchorSet && prevDist >= 0 && rebasedDist <= prevDist

	if isIdle {
		s.session.lastSeen = now
		if !s.session.pausedSinceWall.IsZero() {
			// Already paused — just update lastSeen and return. The
			// ResumeWindow check above handles the eventual close.
			return evs
		}
		// Policy (b): never arm pause during cooldown. Instead, during
		// cooldown check whether the phase plan has completed so we can
		// auto-close via PhaseDone.
		if s.session.currentPhase == PhaseCooldown && s.session.lastStroke != nil {
			// Advance the adjusted time for classify using the idle frame's
			// device time minus accumulated pauses.
			adjustedTimeSec := f.TimeSec - s.session.storageAnchorTimeSec - s.session.pausedAccumSec
			phaseOffsetTime := s.session.phaseAnchorTimeSec - s.session.storageAnchorTimeSec
			_, complete := s.session.plan.Classify(
				s.session.lastStroke.DistanceM-(s.session.phaseAnchorDistance-s.session.storageAnchorDistance),
				adjustedTimeSec-phaseOffsetTime,
			)
			if complete {
				evs = append(evs, s.closeSession()...)
			}
			return evs
		}
		// Not yet paused. Check if PauseTimeout has elapsed since
		// the last distance-advancing activity.
		if s.opts.PauseTimeout > 0 && !s.session.lastActivity.IsZero() &&
			now.Sub(s.session.lastActivity) >= s.opts.PauseTimeout {
			evs = append(evs, s.enterPause(now)...)
		}
		// Idle frames don't produce stroke events; return early.
		return evs
	}

	// ---- Non-idle frame: distance advanced ----

	// If previously paused (via idle-broadcast path), emit session_resumed
	// and account for the device-clock gap during pause.
	if !s.session.pausedSinceWall.IsZero() {
		// The device clock kept ticking during the pause; subtract the
		// accumulated pause seconds before rebasing so the work clock
		// stops during pauses. Compute the gap as device-time since the
		// last real stroke (minus already-accumulated pauses).
		rawTimeSec := f.TimeSec - s.session.storageAnchorTimeSec
		pausedDevice := rawTimeSec - s.session.pausedAccumSec - s.session.pausedAtWorkSec
		if pausedDevice > 0 {
			s.session.pausedAccumSec += pausedDevice
		}
		s.session.pausedSinceWall = time.Time{}
		s.mu.Lock()
		s.currentSessionPaused = nil
		s.mu.Unlock()
		resumeEv := event.Event{
			Kind:         event.KindSessionResumed,
			SessionID:    s.session.id,
			SessionPause: &event.SessionPausePayload{AtTimeSec: s.session.pausedAtWorkSec},
		}
		evs = s.appendEvent(evs, resumeEv)
	} else if s.opts.PauseTimeout > 0 && s.session.lastStroke != nil &&
		now.Sub(s.session.lastSeen) >= s.opts.PauseTimeout {
		// Frame-gap pause: no frames arrived for PauseTimeout (wall clock).
		// The device clock advanced; absorb the device-time gap into
		// pausedAccumSec so the work clock excludes the gap.
		rawTimeSec := f.TimeSec - s.session.storageAnchorTimeSec
		gapSec := rawTimeSec - s.session.pausedAccumSec - s.session.lastStroke.TimeSec
		if gapSec > 0 {
			s.session.pausedAccumSec += gapSec
		}
		at := s.session.lastStroke.TimeSec
		pauseEv := event.Event{
			Kind:         event.KindSessionPaused,
			SessionID:    s.session.id,
			SessionPause: &event.SessionPausePayload{AtTimeSec: at},
		}
		evs = s.appendEvent(evs, pauseEv)
		resumeEv := event.Event{
			Kind:         event.KindSessionResumed,
			SessionID:    s.session.id,
			SessionPause: &event.SessionPausePayload{AtTimeSec: at},
		}
		evs = s.appendEvent(evs, resumeEv)
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

	// Adjust the work clock: subtract accumulated pause time so the
	// work clock stops while the session is paused.
	f.TimeSec -= s.session.pausedAccumSec

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
		evs = append(evs, pc)
		s.session.currentPhase = phase
		s.session.phaseLastTime = stroke.TimeSec
	}

	evs = s.appendEvent(evs, event.Event{
		Kind:      event.KindStroke,
		SessionID: s.session.id,
		Stroke:    &stroke,
	})
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
		evs = s.appendEvent(evs, event.Event{
			Kind:      event.KindLevelChange,
			SessionID: s.session.id,
			LevelChange: &event.LevelChangePayload{
				From: s.session.lastLevel, To: stroke.Level,
				AtStroke: stroke.StrokeNo, AtTimeSec: stroke.TimeSec,
			},
		})
	}
	s.session.lastLevel = stroke.Level
	s.session.lastSeen = now
	// A frame counts as "activity" only if distance advanced.
	if hadPrev && prevDistance != stroke.DistanceM {
		s.session.lastActivity = now
	} else if s.session.strokeSeq == 1 {
		// First stroke: seed activity timer so a brand-new session
		// doesn't immediately trigger inactivity.
		s.session.lastActivity = now
	}
	if complete {
		evs = append(evs, s.closeSession()...)
	}
	return evs
}

func (s *Sessionizer) enrich(f ipm.Frame) event.StrokePayload {
	s.session.strokeSeq++
	p := event.StrokePayload{
		StrokeNo:   s.session.strokeSeq,
		TimeSec:    f.TimeSec,
		At:         f.ReceivedAt,
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

	// Prefer the rower console's own smoothed 500 m split (wire field
	// [11:15]). It matches the LCD readout exactly — same smoothing,
	// same pause behaviour — and removes both the integer-second
	// jitter and the post-pause inflation our host-side derivation
	// suffered from. Falls back to host-time LivePace only when the
	// device hasn't computed a value yet (cold start / mid-pause).
	s.session.recentStrokes = appendAndTrimWindow(s.session.recentStrokes, p, recentStrokesCap)
	if f.DeviceSplitPaceSec > 0 {
		s.session.lastLivePace = f.DeviceSplitPaceSec
		p.PaceSecPer500m = f.DeviceSplitPaceSec
	} else {
		pace, kind := LivePace(s.session.recentStrokes, LivePaceWindow, LivePacePauseThreshold)
		switch kind {
		case LivePaceValue:
			s.session.lastLivePace = pace
			p.PaceSecPer500m = pace
		case LivePaceHeld:
			p.PaceSecPer500m = s.session.lastLivePace
		case LivePaceEmpty:
			p.PaceSecPer500m = 0
		}
	}
	return p
}

// recentStrokesCap bounds the size of the in-memory ring buffer used
// to compute LivePace. LivePace itself selects a sub-slice by host
// time, so this only needs to be "≥ the most strokes that can fit in
// LivePaceWindow at the highest realistic SPM." At 40 SPM (1.5 s /
// stroke) a 10 s window holds 7 strokes; 20 is well clear of that and
// also leaves room for tuning the window upwards.
const recentStrokesCap = 20

// appendAndTrimWindow appends p to buf and caps the buffer length at
// maxLen. LivePace trims further by time inside this buffer.
func appendAndTrimWindow(buf []event.StrokePayload, p event.StrokePayload, maxLen int) []event.StrokePayload {
	buf = append(buf, p)
	if len(buf) > maxLen {
		drop := len(buf) - maxLen
		buf = append(buf[:0], buf[drop:]...)
	}
	return buf
}

func (s *Sessionizer) accumulate(p *event.StrokePayload) {
	st := s.session
	st.acc.strokes++
	if !st.workAnchorSet {
		st.workAnchorSet = true
		st.workAnchorDistance = p.DistanceM
		st.workAnchorTimeSec = p.TimeSec
	}
	st.acc.totalDistance = p.DistanceM - st.workAnchorDistance
	st.acc.totalTime = p.TimeSec - st.workAnchorTimeSec
	st.acc.powerSum += p.PowerW
	if p.PowerW > st.acc.peakPower {
		st.acc.peakPower = p.PowerW
	}
	st.acc.spmSum += p.SPM
	st.acc.dpsSum += p.DPS
	if p.SPM > 0 && p.PowerW >= 20 {
		st.acc.spiSum += p.PowerW / p.SPM
		st.acc.spiCount++
	}
	st.acc.paceSum += p.PaceSecPer500m
	st.acc.calSum += p.EnergyJoules
	p2 := *p
	st.lastStroke = &p2
}


// openSessionPending opens a session triggered by an explicit Start
// request (no frame yet). Initial level defaults to 0 and is updated
// by the first incoming stroke.
func (s *Sessionizer) openSessionPending() []event.Event {
	return s.openSessionInternal(0)
}

func (s *Sessionizer) openSessionInternal(initialLevel int) []event.Event {
	id := s.opts.NewSessionID()
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
	s.currentSessionPaused = nil
	s.mu.Unlock()
	return []event.Event{e}
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

// ClearActiveSession drops the in-memory snapshot of the active
// session for `id`. After it returns, ActiveSessionID() reports ""
// and Snapshot() emits no synthetic session_start/workout_attached/
// phase_change for that session, so reconnecting SSE clients and the
// DELETE handler's active-claim guard agree with the DB that the
// session is no longer live.
//
// Called from two places: (a) the stale-open janitor sweep, after
// flipping a row to status='stale-open' — the session is by
// definition dead (last stroke > threshold ago); (b) the DELETE
// /sessions/{id} handler as a defensive cleanup when the row turned
// out to already be stale-open. The invariant being maintained is:
// status='stale-open' ⇒ no in-memory claim.
//
// Concurrency: only the snapshot trio is mutated, and it is owned by
// s.mu. The Run goroutine's `s.session` accumulator is intentionally
// left untouched here — frames arriving on the dead id eventually
// close it via the IdleTimeout guard in onFrame, and emitting a
// synthetic session_end from this thread would race the persister's
// FinalizeStaleSession write path.
func (s *Sessionizer) ClearActiveSession(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.currentSessionStart == nil {
		return
	}
	if s.currentSessionStart.SessionID != id {
		return
	}
	s.currentSessionStart = nil
	s.currentWorkoutAttached = nil
	s.currentPhaseChange = nil
	s.currentSessionPaused = nil
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

func (s *Sessionizer) closeSession() []event.Event {
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
		TotalDistanceM: st.acc.totalDistance,
		TotalTimeSec:   st.acc.totalTime,
		TotalStrokes:   st.acc.strokes,
		PeakPowerW:     st.acc.peakPower,
		WarmupSec:      st.warmupSec,
		RestSec:        st.restSec,
		CooldownSec:    st.cooldownSec,
	}
	if st.acc.strokes > 0 {
		summary.AvgPowerW = st.acc.powerSum / st.acc.strokes
		summary.AvgSPM = float64(st.acc.spmSum) / float64(st.acc.strokes)
		summary.AvgDPS = st.acc.dpsSum / float64(st.acc.strokes)
		summary.AvgPaceSecPer500m = st.acc.paceSum / st.acc.strokes
		summary.SessionCalories = st.acc.calSum / 1000 // joules → kcal
		if st.acc.spiCount > 0 {
			summary.AvgSPI = st.acc.spiSum / st.acc.spiCount
		}
	}
	s.mu.Lock()
	s.currentSessionStart = nil
	s.currentWorkoutAttached = nil
	s.currentPhaseChange = nil
	s.currentSessionPaused = nil
	s.mu.Unlock()
	e := event.Event{
		Kind:      event.KindSessionEnd,
		SessionID: st.id,
		SessionEnd: &event.SessionEndPayload{
			EndedAt: s.opts.Now(),
			Summary: summary,
		},
	}
	s.stamp(&e)
	return []event.Event{e}
}

// Snapshot returns a slice of synthetic "current state" events (the
// currently open session's session_start, and its latest
// workout_attached if any). Used by the SSE handler to bring
// reconnecting clients up to date when their cursor is past these
// events.
//
// Validates the in-memory cache against the DB first: if the row is
// no longer live (ended, stale-open, missing) the cache is dropped
// before snapshotting, so reconnecting clients can never be told that
// a dead session is still running.
func (s *Sessionizer) Snapshot() []event.Event {
	s.revalidateSnapshot(context.Background())
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
	if s.currentSessionPaused != nil {
		out = append(out, *s.currentSessionPaused)
	}
	return out
}

// revalidateSnapshot drops the in-memory currentSessionStart snapshot
// (and the workout_attached / phase_change companions) if the
// LivenessChecker reports the cached session is no longer the DB's
// "open" row. No-op when no checker is wired or no session is cached.
//
// Safe to call from any goroutine: touches only the mu-protected
// snapshot trio. The Run-goroutine's s.session accumulator is left
// alone (see dropDeadSessionOnStart for the Run-side counterpart).
func (s *Sessionizer) revalidateSnapshot(ctx context.Context) {
	if s.opts.LivenessChecker == nil {
		return
	}
	s.mu.Lock()
	id := ""
	if s.currentSessionStart != nil {
		id = s.currentSessionStart.SessionID
	}
	s.mu.Unlock()
	if id == "" {
		return
	}
	switch s.opts.LivenessChecker.CheckSessionLiveness(ctx, id) {
	case SessionStatusStaleOpen, SessionStatusEnded, SessionStatusMissing:
		s.ClearActiveSession(id)
	}
}

// dropDeadSessionOnStart is the Run-goroutine companion of
// revalidateSnapshot. Called from the startC handler before deciding
// whether to honour or drop a StartSession request. If the DB no
// longer recognises s.session.id as live, the entire in-memory
// accumulator is discarded — without this, the startC handler would
// silently drop the new request via the IdleTimeout heuristic during
// the drift window between "frames stopped" and the next janitor
// sweep.
//
// Only safe from the Run goroutine: s.session is its exclusive
// territory.
func (s *Sessionizer) dropDeadSessionOnStart(ctx context.Context) {
	if s.opts.LivenessChecker == nil || s.session == nil {
		return
	}
	switch s.opts.LivenessChecker.CheckSessionLiveness(ctx, s.session.id) {
	case SessionStatusStaleOpen, SessionStatusEnded, SessionStatusMissing:
		id := s.session.id
		s.session = nil
		s.ClearActiveSession(id)
	}
}

func (s *Sessionizer) closeIfOpenSync() []event.Event {
	if s.session == nil {
		return nil
	}
	return s.closeSession()
}

// OpenSession / ProcessFrame / CloseOpenSession form the synchronous
// driver used by the golden harness (ADR-0017) and unit tests: no
// goroutines, no channels, no sleeps — events come back as the return
// value. Must not be used concurrently with Run.

// OpenSession opens a new session for the given workoutID (empty = free row)
// and returns any emitted events (session_start). Policy (e): if a session
// is already open (even paused), it is closed first.
func (s *Sessionizer) OpenSession(workoutID string) []event.Event {
	var evs []event.Event
	if s.session != nil {
		evs = append(evs, s.closeSession()...)
	}
	if workoutID != "" {
		s.mu.Lock()
		s.pendingWorkoutID = workoutID
		s.mu.Unlock()
	}
	evs = append(evs, s.openSessionPending()...)
	return evs
}

// ProcessFrame processes one frame synchronously and returns the events
// it produces. ctx is reserved for future cancellation support.
func (s *Sessionizer) ProcessFrame(ctx context.Context, f ipm.Frame) ([]event.Event, error) {
	return s.onFrame(f), nil
}

// CloseOpenSession closes the currently open session (if any) and returns
// the events it produces (session_end).
func (s *Sessionizer) CloseOpenSession() []event.Event {
	return s.closeIfOpenSync()
}
