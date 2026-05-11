package api

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

func seedStaleSession(t *testing.T, db *storage.DB, id, rowerID string, startedAt, lastStrokeAt time.Time, strokeGlobalID uint64) {
	t.Helper()
	ctx := context.Background()
	if err := storage.InsertSession(ctx, db.Handle(), id, rowerID, startedAt, 3, ""); err != nil {
		t.Fatal(err)
	}
	p := event.StrokePayload{StrokeNo: 1, TimeSec: 12, DistanceM: 42, SPM: 25, PowerW: 200,
		CalPerHr: 1000, Level: 3, DPS: 5, StrokeCycleSec: 2.4, PaceSecPer500m: 130,
		EnergyJoules: 300, Phase: "work"}
	if err := storage.InsertStroke(ctx, db.Handle(), strokeGlobalID, id, lastStrokeAt, p); err != nil {
		t.Fatal(err)
	}
}

func TestListStaleOpenAPI(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	now := time.Now().UTC()
	seedStaleSession(t, db, "S-stale", "R1", now.Add(-30*time.Minute), now.Add(-10*time.Minute), 1)
	seedStaleSession(t, db, "S-fresh", "R1", now.Add(-2*time.Minute), now.Add(-1*time.Minute), 2)
	// Run sweep to mark stale.
	if _, err := storage.SweepStaleOpen(context.Background(), db.Handle(), 5*time.Minute); err != nil {
		t.Fatal(err)
	}

	h := SessionsHandler(db.Handle(), nil, nil)
	rec := doReq(t, h, "GET", "/api/v1/sessions/stale-open?rower_id=R1")
	if rec.Code != 200 {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Sessions []struct {
			ID             string `json:"id"`
			TotalDistanceM int    `json:"total_distance_m"`
		} `json:"sessions"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Sessions) != 1 {
		t.Fatalf("len = %d, want 1", len(body.Sessions))
	}
	if body.Sessions[0].ID != "S-stale" {
		t.Errorf("id = %q", body.Sessions[0].ID)
	}
	if body.Sessions[0].TotalDistanceM != 42 {
		t.Errorf("total_distance_m = %d, want 42", body.Sessions[0].TotalDistanceM)
	}
}

func TestListStaleOpenAPI_MissingRowerID(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	h := SessionsHandler(db.Handle(), nil, nil)
	rec := doReq(t, h, "GET", "/api/v1/sessions/stale-open")
	if rec.Code != 400 {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestFinalizeSession(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	now := time.Now().UTC()
	last := now.Add(-10 * time.Minute)
	seedStaleSession(t, db, "S-stale", "R1", now.Add(-30*time.Minute), last, 1)
	if _, err := storage.SweepStaleOpen(context.Background(), db.Handle(), 5*time.Minute); err != nil {
		t.Fatal(err)
	}

	h := SessionsHandler(db.Handle(), nil, nil)
	rec := doReq(t, h, "POST", "/api/v1/sessions/S-stale/finalize")
	if rec.Code != 204 {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}

	// Session must now have ended_at set, near last_stroke_at.
	var endedStr string
	if err := db.Handle().QueryRow(`SELECT ended_at FROM sessions WHERE id = 'S-stale'`).Scan(&endedStr); err != nil {
		t.Fatal(err)
	}
	if endedStr == "" {
		t.Fatal("ended_at not set")
	}
	ended, err := time.Parse(time.RFC3339Nano, endedStr)
	if err != nil {
		t.Fatal(err)
	}
	if d := ended.Sub(last); d < -time.Second || d > time.Second {
		t.Errorf("ended_at = %v, want ~= last_stroke_at %v (delta %v)", ended, last, d)
	}

	// Idempotent: second call also returns 204.
	rec2 := doReq(t, h, "POST", "/api/v1/sessions/S-stale/finalize")
	if rec2.Code != 204 {
		t.Errorf("second finalize status = %d, want 204", rec2.Code)
	}
}

func TestFinalizeSession_Unknown_204(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	h := SessionsHandler(db.Handle(), nil, nil)
	rec := doReq(t, h, "POST", "/api/v1/sessions/unknown/finalize")
	// Idempotent: unknown session is treated as already-finalised.
	if rec.Code != 204 {
		t.Errorf("status = %d, want 204", rec.Code)
	}
}
