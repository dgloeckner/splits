package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/insights"
)

func TestGetSessionInsights(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	// Insert rower R1 so the session_insights FK constraint is satisfied
	// (session_insights.rower_id REFERENCES rowers(id)).
	if _, err := db.Handle().Exec(
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','Test','#fff',datetime('now'))`); err != nil {
		t.Fatal(err)
	}

	store := insights.NewStore(db.Handle())
	if err := store.ReplaceForSession(t.Context(), "R1", "S1", []insights.Finding{
		{
			DetectorID: "pacing",
			Code:       insights.CodePositiveSplit,
			Severity:   insights.SeverityNotable,
			Category:   insights.CategoryPacing,
			MessageDE:  "Positiver Split.",
			Evidence:   map[string]float64{"delta": 3.6},
		},
	}); err != nil {
		t.Fatal(err)
	}

	rec := doReq(t, h, "GET", "/api/v1/sessions/S1/insights")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var body struct {
		Findings    []insights.Finding `json:"findings"`
		SynthesisDE string             `json:"synthesis_de"`
		Reason      string             `json:"reason"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	if len(body.Findings) != 1 {
		t.Fatalf("want 1 finding, got %d", len(body.Findings))
	}
	if body.Findings[0].Code != insights.CodePositiveSplit {
		t.Errorf("finding code = %q, want %q", body.Findings[0].Code, insights.CodePositiveSplit)
	}
	if body.SynthesisDE == "" {
		t.Error("synthesis_de is empty")
	}
	if body.Reason != "" {
		t.Errorf("reason should be empty when findings present, got %q", body.Reason)
	}
}

func TestGetSessionInsightsNotFound(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions/nonexistent/insights")
	if rec.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d", rec.Code)
	}
}

func TestGetSessionInsightsTooShort(t *testing.T) {
	// seedDB seeds a session with TotalDistanceM=12, TotalTimeSec=3 — both
	// well below the eligibility thresholds — and no workout attached.
	// With no findings in the DB the handler should report reason=too_short.
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions/S1/insights")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var body struct {
		Findings    []insights.Finding `json:"findings"`
		SynthesisDE string             `json:"synthesis_de"`
		Reason      string             `json:"reason"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	if len(body.Findings) != 0 {
		t.Errorf("want 0 findings, got %d", len(body.Findings))
	}
	if body.Reason != string(insights.ReasonTooShort) {
		t.Errorf("reason = %q, want %q", body.Reason, insights.ReasonTooShort)
	}
}
