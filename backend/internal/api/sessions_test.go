package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

func seedDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	ctx := context.Background()
	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	if err := storage.InsertSession(ctx, db.Handle(), "S1", "R1", started, 3, ""); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 3; i++ {
		p := event.StrokePayload{StrokeNo: i, TimeSec: float64(i), DistanceM: i * 4,
			SPM: 25, PowerW: 200, CalPerHr: 1000, Level: 3,
			DPS: 4, StrokeCycleSec: 1, PaceSecPer500m: 125, EnergyJoules: 200}
		if err := storage.InsertStroke(ctx, db.Handle(), uint64(i), "S1", started, p); err != nil {
			t.Fatal(err)
		}
	}
	if err := storage.UpdateSessionEnd(ctx, db.Handle(), "S1",
		started.Add(time.Minute),
		event.SessionSummary{TotalDistanceM: 12, TotalTimeSec: 3, TotalStrokes: 3,
			AvgPaceSecPer500m: 125}); err != nil {
		t.Fatal(err)
	}
	return db
}

func doReq(t *testing.T, mux http.Handler, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestGetSessionsList(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions?rower_id=R1")
	if rec.Code != 200 {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Sessions []map[string]any `json:"sessions"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if len(body.Sessions) != 1 {
		t.Errorf("got %d sessions", len(body.Sessions))
	}
	if body.Sessions[0]["id"] != "S1" {
		t.Errorf("id = %v", body.Sessions[0]["id"])
	}
}

func TestListSessions_MissingRowerID_Returns400(t *testing.T) {
	t.Parallel()
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions?limit=10")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestGetSessionByID(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions/S1")
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), `"id":"S1"`) {
		t.Errorf("body missing id: %s", body)
	}
}

func TestGetSessionByIDNotFound(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions/nope")
	if rec.Code != 404 {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestGetSessionSamplesNotFound(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions/nope/samples")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestGetSessionSamples(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions/S1/samples")
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Samples []map[string]any `json:"samples"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if len(body.Samples) != 3 {
		t.Errorf("got %d samples", len(body.Samples))
	}
}

func TestGetSessionSamplesFromSummary(t *testing.T) {
	// Simulate a compacted session: strokes deleted, summary has Samples with DPS.
	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx := context.Background()
	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	if err := storage.InsertSession(ctx, db.Handle(), "S2", "R1", started, 3, ""); err != nil {
		t.Fatal(err)
	}
	// Compacted session: store summary_json with Samples, no stroke rows.
	summary := event.SessionSummary{
		TotalDistanceM:    100,
		TotalTimeSec:      60,
		TotalStrokes:      10,
		AvgPaceSecPer500m: 125,
		Samples: &event.SessionSamples{
			BucketStrokes: 5,
			T:             []float64{10.0, 20.0},
			Split:         []int{125, 130},
			Watt:          []int{200, 210},
			SPM:           []int{25, 26},
			DPS:           []float64{8.5, 9.0},
		},
	}
	if err := storage.UpdateSessionEnd(ctx, db.Handle(), "S2", started.Add(time.Minute), summary); err != nil {
		t.Fatal(err)
	}

	h := SessionsHandler(db.Handle(), nil, nil)
	rec := doReq(t, h, "GET", "/api/v1/sessions/S2/samples")
	if rec.Code != 200 {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Samples []map[string]any `json:"samples"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Samples) != 2 {
		t.Fatalf("got %d samples, want 2", len(body.Samples))
	}
	// DPS should be non-zero.
	dps0, _ := body.Samples[0]["dps"].(float64)
	if dps0 == 0 {
		t.Errorf("samples[0].dps = 0, want non-zero (from summary)")
	}
}

type fakeActive struct{ id string }

func (f fakeActive) ActiveSessionID() string { return f.id }

func TestDeleteSession_ActiveSession_Returns409(t *testing.T) {
	t.Parallel()
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, fakeActive{id: "S1"})

	rec := doReq(t, h, "DELETE", "/api/v1/sessions/S1")
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", rec.Code, rec.Body.String())
	}

	// Sanity: the session row should still exist.
	rec = doReq(t, h, "GET", "/api/v1/sessions/S1")
	if rec.Code != http.StatusOK {
		t.Errorf("after rejected DELETE, GET status = %d, want 200", rec.Code)
	}
}

// TestDeleteSession_StaleOpenSessionStillInMemory_Returns204 reproduces
// the bug where a session that the janitor has flipped to
// `status='stale-open'` cannot be discarded from Home because the live
// sessionizer's `currentSessionStart` is still set (frames stopped
// arriving but the IdleTimeout guard in onFrame only fires *on* a
// frame). The DELETE handler used to reject with 409, the
// `StaleSessionCard` discard mutation swallowed the error, and the
// recovery card came back on every reload.
//
// Contract after fix: when the DB row is status='stale-open', the
// session is by definition dead — DELETE must succeed regardless of
// in-memory state, and the active claim is dropped.
func TestDeleteSession_StaleOpenSessionStillInMemory_Returns204(t *testing.T) {
	t.Parallel()
	db := seedStaleOpenDB(t)
	cleared := &clearableActive{id: "S1"}
	h := SessionsHandler(db.Handle(), nil, cleared)

	rec := doReq(t, h, "DELETE", "/api/v1/sessions/S1")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE status = %d, want 204 (body=%s)", rec.Code, rec.Body.String())
	}
	rec = doReq(t, h, "GET", "/api/v1/sessions/S1")
	if rec.Code != 404 {
		t.Errorf("after delete, GET status = %d, want 404", rec.Code)
	}
	if cleared.id != "" {
		t.Errorf("active.id = %q after DELETE of stale-open session, want empty (in-memory must be cleared)", cleared.id)
	}
}

// seedStaleOpenDB seeds a single stale-open session row "S1" for R1.
func seedStaleOpenDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	ctx := context.Background()
	started := time.Now().UTC().Add(-30 * time.Minute)
	lastStroke := time.Now().UTC().Add(-10 * time.Minute)
	if err := storage.InsertSession(ctx, db.Handle(), "S1", "R1", started, 3, ""); err != nil {
		t.Fatal(err)
	}
	p := event.StrokePayload{StrokeNo: 1, TimeSec: 1, DistanceM: 5, SPM: 20, PowerW: 100,
		CalPerHr: 600, Level: 3, DPS: 5, StrokeCycleSec: 3, PaceSecPer500m: 130,
		EnergyJoules: 100, Phase: "work"}
	if err := storage.InsertStroke(ctx, db.Handle(), 1, "S1", lastStroke, p); err != nil {
		t.Fatal(err)
	}
	if _, err := storage.SweepStaleOpen(ctx, db.Handle(), 5*time.Minute); err != nil {
		t.Fatal(err)
	}
	return db
}

// clearableActive is fakeActive + a Clear method. The DELETE handler is
// expected to call Clear(id) when the row's status is `stale-open`, so
// the in-memory sessionizer no longer claims a dead session.
type clearableActive struct{ id string }

func (a *clearableActive) ActiveSessionID() string { return a.id }
func (a *clearableActive) ClearActiveSession(id string) {
	if a.id == id {
		a.id = ""
	}
}

// endableActive is fakeActive + an EndSession hook. Models the
// production sessionizer for the "Verwerfen on live session" path: the
// DELETE handler must call EndSession() and wait until the row's
// ended_at is set before proceeding with the hard-delete.
//
// onEnd simulates the persister's commit by flipping ended_at on the
// row asynchronously, so the DELETE handler's waitForSessionEnded
// poll has something to observe.
type endableActive struct {
	id    string
	onEnd func()
}

func (a *endableActive) ActiveSessionID() string { return a.id }
func (a *endableActive) EndSession() {
	if a.onEnd != nil {
		go a.onEnd()
	}
}

// TestDeleteSession_LiveSession_EndsAndDeletes reproduces the
// "cancelled session still in history" bug: PauseDialog "Verwerfen"
// fired DELETE on a still-live session, the handler returned 409, the
// frontend swallowed it, and the row landed in history once the
// sessionizer's idle guard finally closed it. With the fix, the
// handler ends the live session, waits for the persister, then
// deletes — same outcome as if the rower had pressed Verwerfen on a
// stale-open row.
func TestDeleteSession_LiveSession_EndsAndDeletes(t *testing.T) {
	t.Parallel()
	db := seedDB(t)
	// Re-open the seeded row as a "live" session: clear ended_at so it
	// looks like an in-progress session that the sessionizer still
	// owns. (seedDB itself writes ended_at via UpdateSessionEnd.)
	ctx := context.Background()
	if _, err := db.Handle().ExecContext(ctx,
		`UPDATE sessions SET ended_at = NULL, status = 'open' WHERE id = 'S1'`); err != nil {
		t.Fatal(err)
	}
	active := &endableActive{
		id: "S1",
		onEnd: func() {
			// Persister mock: a few ms after EndSession() the row gets
			// ended_at set, releasing the DELETE handler's wait loop.
			time.Sleep(20 * time.Millisecond)
			_, _ = db.Handle().ExecContext(context.Background(),
				`UPDATE sessions SET ended_at = ? WHERE id = 'S1'`,
				time.Now().UTC().Format(time.RFC3339Nano))
		},
	}
	h := SessionsHandler(db.Handle(), nil, active)

	rec := doReq(t, h, "DELETE", "/api/v1/sessions/S1")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE status = %d, want 204 (body=%s)", rec.Code, rec.Body.String())
	}
	rec = doReq(t, h, "GET", "/api/v1/sessions/S1")
	if rec.Code != 404 {
		t.Errorf("after live-discard DELETE, GET status = %d, want 404", rec.Code)
	}
	// And the row must not show up in listSessions (the history feed).
	rec = doReq(t, h, "GET", "/api/v1/sessions?rower_id=R1")
	var body struct {
		Sessions []map[string]any `json:"sessions"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if len(body.Sessions) != 0 {
		t.Errorf("live-discarded session still in history list: %v", body.Sessions)
	}
}

// TestDeleteSession_LiveSession_NoEnder_StillRefuses preserves the
// 409 contract for any ActiveSessionIDer that does NOT also implement
// ActiveSessionEnder (test stubs, future read-only adapters). Without
// the hook the handler has no safe way to synchronise, so the
// original guard kicks in.
func TestDeleteSession_LiveSession_NoEnder_StillRefuses(t *testing.T) {
	t.Parallel()
	db := seedDB(t)
	ctx := context.Background()
	if _, err := db.Handle().ExecContext(ctx,
		`UPDATE sessions SET ended_at = NULL, status = 'open' WHERE id = 'S1'`); err != nil {
		t.Fatal(err)
	}
	h := SessionsHandler(db.Handle(), nil, fakeActive{id: "S1"})

	rec := doReq(t, h, "DELETE", "/api/v1/sessions/S1")
	if rec.Code != http.StatusConflict {
		t.Fatalf("DELETE status = %d, want 409 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestDeleteSessionSoftDeletes(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "DELETE", "/api/v1/sessions/S1")
	if rec.Code != 204 {
		t.Errorf("status = %d, want 204", rec.Code)
	}

	rec = doReq(t, h, "GET", "/api/v1/sessions/S1")
	if rec.Code != 404 {
		t.Errorf("after delete, GET status = %d, want 404", rec.Code)
	}

	rec = doReq(t, h, "GET", "/api/v1/sessions?rower_id=R1")
	var body struct {
		Sessions []map[string]any `json:"sessions"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if len(body.Sessions) != 0 {
		t.Errorf("soft-deleted session still in list")
	}
}
