package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// startServerWithOpts mirrors startServer but lets the test choose
// pacing and a fixture-replay delay so it can POST /session/start
// before the producer begins emitting frames.
func startServerWithOpts(t *testing.T, fixture, rate, delay string) (string, string) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()

	db := filepath.Join(t.TempDir(), "homeergo.db")
	os.Setenv("HOMEERGO_ADDR", addr)
	os.Setenv("HOMEERGO_DB_PATH", db)
	os.Setenv("HOMEERGO_FIXTURE", fixture)
	os.Setenv("HOMEERGO_FIXTURE_RATE", rate)
	os.Setenv("SPLITS_FIXTURE_DELAY", delay)
	os.Setenv("HOMEERGO_IDLE_TIMEOUT", "60s")

	done := make(chan error, 1)
	go func() { done <- run() }()
	t.Cleanup(func() {
		proc, err := os.FindProcess(os.Getpid())
		if err == nil {
			_ = proc.Signal(syscall.SIGTERM)
		}
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Log("server did not shut down within 5s")
		}
	})
	waitForServer(t, "http://"+addr+"/api/health")
	return "http://" + addr, db
}

// TestInsightsE2EFixtureReplay drives the full ingest path through
// a fixture replay and queries the new
// GET /api/v1/sessions/{id}/insights endpoint after the session ends.
//
// The m3-long fixture is 1035m / 284s — below the 5min eligibility
// gate — so the response should be `{findings: [], reason: "too_short"}`.
// That asserts:
//   - persister.applySessionEnd ran insights inline,
//   - the route is wired,
//   - the eligibility gate produces the expected reason at the API.
func TestInsightsE2EFixtureReplay(t *testing.T) {
	base, dbPath := startServerWithOpts(t,
		"../../../specs/int/fixtures/ipm/session-m3-long.csv",
		"fast", "300ms")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	startReq, _ := http.NewRequestWithContext(ctx,
		"POST", base+"/api/v1/session/start",
		strings.NewReader("{}"))
	startResp, err := http.DefaultClient.Do(startReq)
	if err != nil {
		t.Fatal(err)
	}
	startResp.Body.Close()

	// Wait for fixture playback + sessionizer pipeline to drain. With
	// PacingFast and a 300 ms producer delay, all 124 strokes are
	// processed within a few hundred ms; a one-second budget is plenty.
	time.Sleep(1500 * time.Millisecond)

	endReq, _ := http.NewRequestWithContext(ctx,
		"POST", base+"/api/v1/session/end",
		strings.NewReader(""))
	endResp, err := http.DefaultClient.Do(endReq)
	if err != nil {
		t.Fatal(err)
	}
	endResp.Body.Close()

	// Discover the just-ended session by reading the SQLite the server wrote.
	// The /api/v1/sessions list endpoint requires a rower_id query param,
	// and this fixture replay never picked up an active rower; querying
	// the DB directly avoids that scaffolding without changing the
	// server's storage shape.
	conn, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	// applySessionEnd runs asynchronously in the persister goroutine.
	// Poll the DB until ended_at is populated so the rest of the test
	// observes a fully-committed session.
	var sessionID string
	var totalTime float64
	var totalDist int
	deadline := time.Now().Add(5 * time.Second)
	for {
		row := conn.QueryRowContext(ctx, `
			SELECT id, total_time_sec, total_distance_m
			FROM sessions
			WHERE ended_at IS NOT NULL
			ORDER BY started_at DESC LIMIT 1`)
		err := row.Scan(&sessionID, &totalTime, &totalDist)
		if err == nil && sessionID != "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("session never persisted with ended_at: %v", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Logf("e2e session: id=%s duration=%.1fs distance=%dm",
		sessionID, totalTime, totalDist)

	insightsReq, _ := http.NewRequestWithContext(ctx,
		"GET", base+"/api/v1/sessions/"+sessionID+"/insights", nil)
	insightsResp, err := http.DefaultClient.Do(insightsReq)
	if err != nil {
		t.Fatal(err)
	}
	defer insightsResp.Body.Close()
	if insightsResp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", insightsResp.StatusCode)
	}
	insightsBody, _ := io.ReadAll(insightsResp.Body)
	var got struct {
		Findings    []map[string]any `json:"findings"`
		SynthesisDE string           `json:"synthesis_de"`
		Reason      string           `json:"reason"`
	}
	if err := json.Unmarshal(insightsBody, &got); err != nil {
		t.Fatalf("decode insights: %v\nbody=%s", err, insightsBody)
	}

	t.Logf("e2e insights: findings=%d reason=%q synthesis=%q",
		len(got.Findings), got.Reason, got.SynthesisDE)

	if len(got.Findings) != 0 {
		t.Errorf("expected zero findings (fixture too short), got %d", len(got.Findings))
	}
	if got.Reason != "too_short" {
		t.Errorf("reason = %q, want too_short", got.Reason)
	}
	if got.SynthesisDE != "" {
		t.Errorf("expected empty synthesis on ineligible session, got %q", got.SynthesisDE)
	}
}
