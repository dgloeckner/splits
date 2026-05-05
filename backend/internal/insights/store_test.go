package insights_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/insights"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

// openTestDB opens an in-memory SQLite DB (with all migrations applied)
// and registers cleanup.
func openTestDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// mustExec runs a SQL statement and fatals on error.
func mustExec(t *testing.T, db *storage.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Handle().Exec(query, args...); err != nil {
		t.Fatalf("mustExec(%q): %v", query, err)
	}
}

func seedSession(t *testing.T, db *storage.DB, rowerID, sessionID string) {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	mustExec(t, db,
		`INSERT INTO rowers(id, name, color, created_at) VALUES (?,?,?,?)`,
		rowerID, "R", "#ff0000", now)
	mustExec(t, db,
		`INSERT INTO sessions(id, rower_id, started_at, ended_at, initial_level) VALUES (?,?,?,?,?)`,
		sessionID, rowerID, now, now, 3)
}

func TestStoreInsertAndList(t *testing.T) {
	db := openTestDB(t)
	rowerID, sessionID := "r1", "s1"
	seedSession(t, db, rowerID, sessionID)

	store := insights.NewStore(db.Handle())
	findings := []insights.Finding{
		{
			DetectorID: "pacing", Code: insights.CodePositiveSplit,
			Severity: insights.SeverityNotable, Category: insights.CategoryPacing,
			MessageDE: "msg", Evidence: map[string]float64{"delta": 3.6},
		},
	}
	if err := store.ReplaceForSession(context.Background(), rowerID, sessionID, findings); err != nil {
		t.Fatal(err)
	}
	got, err := store.ListForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Code != insights.CodePositiveSplit {
		t.Fatalf("got %+v", got)
	}
	if got[0].Evidence["delta"] != 3.6 {
		t.Errorf("evidence delta = %v", got[0].Evidence["delta"])
	}
}

func TestStoreReplaceIsIdempotent(t *testing.T) {
	db := openTestDB(t)
	rowerID, sessionID := "r1", "s1"
	seedSession(t, db, rowerID, sessionID)

	store := insights.NewStore(db.Handle())
	f := []insights.Finding{{
		DetectorID: "pacing", Code: insights.CodeEvenSplit,
		Severity: insights.SeverityInfo, Category: insights.CategoryPacing,
		MessageDE: "x", Evidence: map[string]float64{},
	}}
	for i := 0; i < 2; i++ {
		if err := store.ReplaceForSession(context.Background(), rowerID, sessionID, f); err != nil {
			t.Fatal(err)
		}
	}
	got, _ := store.ListForSession(context.Background(), sessionID)
	if len(got) != 1 {
		t.Errorf("expected 1 row after double-replace, got %d", len(got))
	}
}

func TestStoreListOrdersBySeverity(t *testing.T) {
	db := openTestDB(t)
	rowerID, sessionID := "r1", "s1"
	seedSession(t, db, rowerID, sessionID)

	store := insights.NewStore(db.Handle())
	findings := []insights.Finding{
		{DetectorID: "consistency", Code: insights.CodeConsistentHigh, Severity: insights.SeverityInfo, Category: insights.CategoryConsistency, MessageDE: "info", Evidence: map[string]float64{}},
		{DetectorID: "fade", Code: insights.CodeFade, Severity: insights.SeverityAttention, Category: insights.CategoryEfficiency, MessageDE: "attention", Evidence: map[string]float64{}},
		{DetectorID: "pacing", Code: insights.CodePositiveSplit, Severity: insights.SeverityNotable, Category: insights.CategoryPacing, MessageDE: "notable", Evidence: map[string]float64{}},
	}
	if err := store.ReplaceForSession(context.Background(), rowerID, sessionID, findings); err != nil {
		t.Fatal(err)
	}
	got, err := store.ListForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 findings, got %d", len(got))
	}
	if got[0].Severity != insights.SeverityAttention {
		t.Errorf("first finding should be ATTENTION, got %q", got[0].Severity)
	}
	if got[1].Severity != insights.SeverityNotable {
		t.Errorf("second finding should be NOTABLE, got %q", got[1].Severity)
	}
	if got[2].Severity != insights.SeverityInfo {
		t.Errorf("third finding should be INFO, got %q", got[2].Severity)
	}
}
