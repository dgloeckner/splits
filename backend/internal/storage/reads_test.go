package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
)

func seedSessions(t *testing.T, db *DB, n int) []string {
	t.Helper()
	ctx := context.Background()
	ids := make([]string, 0, n)
	for i := 0; i < n; i++ {
		id := string(rune('A'+i)) + "id"
		started := time.Date(2026, 4, 20+i, 10, 0, 0, 0, time.UTC)
		if err := InsertSession(ctx, db.Handle(), id, "R1", started, 3, ""); err != nil {
			t.Fatalf("seed[%d]: %v", i, err)
		}
		// List query filters out sessions with zero strokes — seed one.
		stroke := event.StrokePayload{
			StrokeNo: 1, TimeSec: 2, DistanceM: 8, SPM: 25, PowerW: 200,
			CalPerHr: 1000, Level: 3, DPS: 8, StrokeCycleSec: 2,
			PaceSecPer500m: 125, EnergyJoules: 400,
		}
		if err := InsertStroke(ctx, db.Handle(), uint64(100+i), id, started, stroke); err != nil {
			t.Fatalf("seed stroke[%d]: %v", i, err)
		}
		if err := UpdateSessionEnd(ctx, db.Handle(), id, started.Add(5*time.Minute),
			event.SessionSummary{TotalDistanceM: 1000 * (i + 1), TotalTimeSec: 300,
				TotalStrokes: 100 + i, AvgPaceSecPer500m: 130}); err != nil {
			t.Fatalf("end seed[%d]: %v", i, err)
		}
		ids = append(ids, id)
	}
	return ids
}

func TestListSessionsDescByStartedAt(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seedSessions(t, db, 3)

	rows, err := ListSessions(context.Background(), db.Handle(), 10, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("got %d rows", len(rows))
	}
	if rows[0].ID != "Cid" || rows[2].ID != "Aid" {
		t.Errorf("order wrong: %v", []string{rows[0].ID, rows[1].ID, rows[2].ID})
	}
}

func TestListSessionsPagination(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	seedSessions(t, db, 5)

	p1, _ := ListSessions(context.Background(), db.Handle(), 2, 0, "")
	p2, _ := ListSessions(context.Background(), db.Handle(), 2, 2, "")
	if len(p1) != 2 || len(p2) != 2 {
		t.Fatalf("page sizes: %d %d", len(p1), len(p2))
	}
	if p1[0].ID == p2[0].ID {
		t.Errorf("pages overlap")
	}
}

func TestListSessionsFiltersByRowerID(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	ctx := context.Background()
	// Two rowers, two sessions each.
	for i, rower := range []string{"R1", "R2"} {
		for j := 0; j < 2; j++ {
			id := rower + "_" + string(rune('A'+j))
			started := time.Date(2026, 4, 20+i*10+j, 10, 0, 0, 0, time.UTC)
			if err := InsertSession(ctx, db.Handle(), id, rower, started, 3, ""); err != nil {
				t.Fatalf("insert: %v", err)
			}
			stroke := event.StrokePayload{
				StrokeNo: 1, TimeSec: 2, DistanceM: 8, SPM: 25, PowerW: 200,
				CalPerHr: 1000, Level: 3, DPS: 8, StrokeCycleSec: 2,
				PaceSecPer500m: 125, EnergyJoules: 400,
			}
			if err := InsertStroke(ctx, db.Handle(), uint64(1000+i*10+j), id, started, stroke); err != nil {
				t.Fatalf("stroke: %v", err)
			}
			if err := UpdateSessionEnd(ctx, db.Handle(), id, started.Add(time.Minute),
				event.SessionSummary{TotalDistanceM: 500, TotalTimeSec: 60, TotalStrokes: 50}); err != nil {
				t.Fatalf("end: %v", err)
			}
		}
	}
	all, _ := ListSessions(ctx, db.Handle(), 10, 0, "")
	if len(all) != 4 {
		t.Fatalf("all: got %d", len(all))
	}
	r1, _ := ListSessions(ctx, db.Handle(), 10, 0, "R1")
	if len(r1) != 2 {
		t.Fatalf("R1: got %d", len(r1))
	}
	for _, row := range r1 {
		if row.RowerID != "R1" {
			t.Errorf("R1 leak: %q", row.RowerID)
		}
	}
	none, _ := ListSessions(ctx, db.Handle(), 10, 0, "R3")
	if len(none) != 0 {
		t.Fatalf("R3: got %d", len(none))
	}
}

func TestListSessionsExcludesDeleted(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	ids := seedSessions(t, db, 3)
	// Post-FEAT-0009: deletion is hard, not soft. Removing the row
	// from sessions is enough to drop it from list output.
	if _, err := db.Handle().Exec(`DELETE FROM strokes WHERE session_id = ?`, ids[1]); err != nil {
		t.Fatalf("delete strokes: %v", err)
	}
	if _, err := db.Handle().Exec(`DELETE FROM sessions WHERE id = ?`, ids[1]); err != nil {
		t.Fatalf("delete session: %v", err)
	}
	rows, _ := ListSessions(context.Background(), db.Handle(), 10, 0, "")
	if len(rows) != 2 {
		t.Errorf("got %d rows, want 2 (one hard-deleted)", len(rows))
	}
	for _, r := range rows {
		if r.ID == ids[1] {
			t.Errorf("deleted session %q leaked into list", r.ID)
		}
	}
}

func TestGetSessionReturnsDetail(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	ids := seedSessions(t, db, 1)

	got, err := GetSession(context.Background(), db.Handle(), ids[0])
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got == nil || got.ID != ids[0] {
		t.Errorf("got %+v", got)
	}
	if got.Summary.TotalDistanceM != 1000 {
		t.Errorf("summary.TotalDistanceM = %d", got.Summary.TotalDistanceM)
	}
}

func TestGetSessionNilForMissingOrDeleted(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	got, err := GetSession(context.Background(), db.Handle(), "nope")
	if err != nil || got != nil {
		t.Errorf("expected nil session, no error; got %v / %v", got, err)
	}

	ids := seedSessions(t, db, 1)
	// Hard-delete (post-FEAT-0009): drop dependents first, then the row.
	if _, err := db.Handle().Exec(`DELETE FROM strokes WHERE session_id = ?`, ids[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Handle().Exec(`DELETE FROM sessions WHERE id = ?`, ids[0]); err != nil {
		t.Fatal(err)
	}
	got, err = GetSession(context.Background(), db.Handle(), ids[0])
	if err != nil || got != nil {
		t.Errorf("expected nil for deleted session; got %v / %v", got, err)
	}
}

func TestListSamplesOrderByStrokeNo(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	ctx := context.Background()
	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	_ = InsertSession(ctx, db.Handle(), "S1", "R1", started, 3, "")
	for _, n := range []int{3, 1, 2} {
		p := event.StrokePayload{StrokeNo: n, TimeSec: float64(n) * 2, DistanceM: n * 8,
			SPM: 25, PowerW: 200, CalPerHr: 1000, Level: 3,
			DPS: 8, StrokeCycleSec: 2, PaceSecPer500m: 125, EnergyJoules: 400}
		_ = InsertStroke(ctx, db.Handle(), uint64(n), "S1", started, p)
	}

	samples, err := ListSamples(ctx, db.Handle(), "S1")
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 3 {
		t.Fatalf("got %d", len(samples))
	}
	if samples[0].StrokeNo != 1 || samples[2].StrokeNo != 3 {
		t.Errorf("not sorted: %+v", samples)
	}
}
