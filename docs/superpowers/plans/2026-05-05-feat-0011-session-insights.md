# FEAT-0011 Session Insights — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-session, rules-based "Auswertung" (Pacing/Fade/Consistency) with German findings + synthesis paragraph rendered on Session-Detail.

**Architecture:** New `splits/internal/insights` Go package with three pure-function detectors over `summary_json.samples`. Findings persist in a new `session_insights` table written from `applySessionEnd` (mirrors how PB candidates are persisted). API endpoint `GET /api/v1/sessions/{id}/insights` reads back. Frontend renders one `InsightsSection` between Session-Detail header and charts.

**Tech Stack:** Go 1.22 (stdlib + modernc/sqlite), React/TypeScript (Vite), CSS Modules. Existing patterns: table-driven Go tests, RTL component tests (`*.test.tsx`).

**Spec:** `specs/feat/0011-session-insights.md`

---

## File Structure

**Backend (Go):**
- Create: `backend/internal/storage/migrations/0013_session_insights.sql`
- Create: `backend/internal/insights/types.go` — Severity, Category, Code, Finding
- Create: `backend/internal/insights/format.go` — German number/split formatting
- Create: `backend/internal/insights/format_test.go`
- Create: `backend/internal/insights/pacing.go`
- Create: `backend/internal/insights/pacing_test.go`
- Create: `backend/internal/insights/fade.go`
- Create: `backend/internal/insights/fade_test.go`
- Create: `backend/internal/insights/consistency.go`
- Create: `backend/internal/insights/consistency_test.go`
- Create: `backend/internal/insights/eligibility.go`
- Create: `backend/internal/insights/eligibility_test.go`
- Create: `backend/internal/insights/synthesis.go`
- Create: `backend/internal/insights/synthesis_test.go`
- Create: `backend/internal/insights/run.go` — orchestrator: Eligibility → Detectors → Synthesis
- Create: `backend/internal/insights/run_test.go`
- Create: `backend/internal/insights/store.go` — Insert + List
- Create: `backend/internal/insights/store_test.go`
- Modify: `backend/internal/storage/persister.go` — call insights from `applySessionEnd`
- Create: `backend/internal/api/insights.go` — `GET /sessions/{id}/insights`
- Create: `backend/internal/api/insights_test.go`
- Modify: `backend/internal/api/sessions.go` — wire route
- Create: `backend/cmd/insights-backfill/main.go` — one-shot backfill over existing sessions

**Frontend (TS/React):**
- Create: `web/src/api/insights.ts`
- Create: `web/src/api/insights.test.ts`
- Create: `web/src/pages/session/FindingCard.tsx`
- Create: `web/src/pages/session/FindingCard.module.css`
- Create: `web/src/pages/session/FindingCard.test.tsx`
- Create: `web/src/pages/session/InsightsSection.tsx`
- Create: `web/src/pages/session/InsightsSection.module.css`
- Create: `web/src/pages/session/InsightsSection.test.tsx`
- Modify: `web/src/pages/SessionDetailPage.tsx` — render `<InsightsSection>` between header and charts
- Modify: `web/src/pages/SessionDetailPage.test.tsx` — assert section presence

---

### Task 1: Migration 0013

**Files:**
- Create: `backend/internal/storage/migrations/0013_session_insights.sql`

- [ ] **Step 1: Write migration**

```sql
-- FEAT-0011 session insights: per-session findings (Pacing/Fade/Consistency).
-- Self-sufficient rows; no joins to strokes (deleted by FEAT-0009 Mode 0).

CREATE TABLE IF NOT EXISTS session_insights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rower_id      TEXT NOT NULL,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  detector_id   TEXT NOT NULL,
  code          TEXT NOT NULL,
  severity      TEXT NOT NULL,
  category      TEXT NOT NULL,
  message_de    TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  computed_at   TEXT NOT NULL,
  UNIQUE(session_id, detector_id)
);

CREATE INDEX IF NOT EXISTS idx_session_insights_rower
  ON session_insights(rower_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_insights_session
  ON session_insights(session_id);
```

- [ ] **Step 2: Run migration test**

Run: `cd backend && go test ./internal/storage/...`
Expected: PASS — existing migration tests apply 0013 without error.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/storage/migrations/0013_session_insights.sql
git commit -m "feat(insights): migration 0013 — session_insights table"
```

---

### Task 2: Types

**Files:**
- Create: `backend/internal/insights/types.go`

- [ ] **Step 1: Write types**

```go
// Package insights implements FEAT-0011 — per-session, rules-based
// findings (Pacing/Fade/Consistency) computed from
// summary_json.samples at session_end.
package insights

type Severity string

const (
	SeverityInfo      Severity = "INFO"
	SeverityNotable   Severity = "NOTABLE"
	SeverityAttention Severity = "ATTENTION"
)

type Category string

const (
	CategoryPacing      Category = "PACING"
	CategoryEfficiency  Category = "EFFICIENCY"
	CategoryConsistency Category = "CONSISTENCY"
)

// Code is the stable, machine-readable identifier for a finding kind.
type Code string

const (
	CodePositiveSplit  Code = "POSITIVE_SPLIT"
	CodeNegativeSplit  Code = "NEGATIVE_SPLIT"
	CodeEvenSplit      Code = "EVEN_SPLIT"
	CodeFade           Code = "FADE"
	CodeConsistentHigh Code = "CONSISTENT_HIGH"
	CodeConsistentMid  Code = "CONSISTENT_MID"
	CodeInconsistent   Code = "INCONSISTENT"
)

// Finding is the unit emitted by every detector.
type Finding struct {
	DetectorID string             `json:"detector_id"`
	Code       Code               `json:"code"`
	Severity   Severity           `json:"severity"`
	Category   Category           `json:"category"`
	MessageDE  string             `json:"message_de"`
	Evidence   map[string]float64 `json:"evidence"`
}
```

- [ ] **Step 2: Verify compiles**

Run: `cd backend && go build ./internal/insights/...`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/insights/types.go
git commit -m "feat(insights): finding/severity/category/code types"
```

---

### Task 3: German Formatting

**Files:**
- Create: `backend/internal/insights/format.go`
- Create: `backend/internal/insights/format_test.go`

- [ ] **Step 1: Write failing tests**

```go
package insights

import "testing"

func TestFormatDecimal(t *testing.T) {
	cases := []struct {
		v        float64
		decimals int
		want     string
	}{
		{3.6, 1, "3,6"},
		{0.10, 2, "0,10"},
		{6.84, 1, "6,8"},
		{2.0, 1, "2,0"},
	}
	for _, c := range cases {
		got := FormatDecimal(c.v, c.decimals)
		if got != c.want {
			t.Errorf("FormatDecimal(%v,%d) = %q, want %q", c.v, c.decimals, got, c.want)
		}
	}
}

func TestFormatSplit(t *testing.T) {
	cases := []struct {
		secPer500m float64
		want       string
	}{
		{119.6, "1:59,6"},
		{123.2, "2:03,2"},
		{60.0, "1:00,0"},
		{125.05, "2:05,1"},
	}
	for _, c := range cases {
		got := FormatSplit(c.secPer500m)
		if got != c.want {
			t.Errorf("FormatSplit(%v) = %q, want %q", c.secPer500m, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd backend && go test ./internal/insights/... -run Format -v`
Expected: FAIL — undefined `FormatDecimal`, `FormatSplit`.

- [ ] **Step 3: Implement**

```go
package insights

import (
	"fmt"
	"math"
	"strings"
)

// FormatDecimal renders a float with comma decimal separator and the
// given number of fractional digits. Used in all German messages.
func FormatDecimal(v float64, decimals int) string {
	s := fmt.Sprintf("%.*f", decimals, v)
	return strings.Replace(s, ".", ",", 1)
}

// FormatSplit renders seconds-per-500m as "m:ss,t" with comma
// decimal. Rounds to one decimal.
func FormatSplit(secPer500m float64) string {
	rounded := math.Round(secPer500m*10) / 10
	mins := int(rounded) / 60
	rem := rounded - float64(mins*60)
	wholeSec := int(rem)
	tenths := int(math.Round((rem-float64(wholeSec))*10)) % 10
	if tenths < 0 {
		tenths += 10
	}
	return fmt.Sprintf("%d:%02d,%d", mins, wholeSec, tenths)
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd backend && go test ./internal/insights/... -run Format -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/insights/format.go backend/internal/insights/format_test.go
git commit -m "feat(insights): German number/split formatting"
```

---

### Task 4: PacingDetector

**Files:**
- Create: `backend/internal/insights/pacing.go`
- Create: `backend/internal/insights/pacing_test.go`

The detector consumes `event.SessionSamples` (defined in
`backend/internal/event` — has `T []float64`, `Split []int`, `Watt
[]int`, `SPM []int`, `DPS []float64`, `SPI []int`).

- [ ] **Step 1: Write failing tests**

```go
package insights

import (
	"math"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

func samplesFromSplits(splits []int) *event.SessionSamples {
	s := &event.SessionSamples{Split: splits}
	for i := range splits {
		s.T = append(s.T, float64(i+1))
		s.Watt = append(s.Watt, 200)
		s.SPM = append(s.SPM, 22)
		s.DPS = append(s.DPS, 9.0)
		s.SPI = append(s.SPI, 9)
	}
	return s
}

func TestPacingPositiveSplit(t *testing.T) {
	// First half ~119.6, second half ~123.2 → +3.6s.
	s := samplesFromSplits([]int{118, 119, 120, 120, 121, 121, 122, 123, 124, 126})
	f, ok := DetectPacing(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodePositiveSplit {
		t.Fatalf("code = %q, want POSITIVE_SPLIT", f.Code)
	}
	if f.Severity != SeverityNotable {
		t.Errorf("severity = %q, want NOTABLE", f.Severity)
	}
	if math.Abs(f.Evidence["delta"]-3.6) > 0.05 {
		t.Errorf("delta = %v, want ~3.6", f.Evidence["delta"])
	}
	if f.MessageDE != "Positiver Split: Zweite Hälfte im Schnitt 3,6s langsamer als die erste (1:59,6 → 2:03,2)." {
		t.Errorf("message: %q", f.MessageDE)
	}
}

func TestPacingNegativeSplit(t *testing.T) {
	s := samplesFromSplits([]int{126, 125, 124, 123, 122, 121, 120, 119, 118, 117})
	f, ok := DetectPacing(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeNegativeSplit {
		t.Fatalf("code = %q, want NEGATIVE_SPLIT", f.Code)
	}
	if f.Severity != SeverityInfo {
		t.Errorf("severity = %q, want INFO", f.Severity)
	}
}

func TestPacingEvenSplit(t *testing.T) {
	s := samplesFromSplits([]int{120, 121, 120, 121, 120, 121, 120, 121, 120, 121})
	f, ok := DetectPacing(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeEvenSplit {
		t.Fatalf("code = %q, want EVEN_SPLIT", f.Code)
	}
}

func TestPacingEmptySamplesSkips(t *testing.T) {
	if _, ok := DetectPacing(&event.SessionSamples{}); ok {
		t.Fatal("expected no finding on empty samples")
	}
}
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd backend && go test ./internal/insights/... -run Pacing -v`
Expected: FAIL — `DetectPacing` undefined.

- [ ] **Step 3: Implement**

```go
package insights

import (
	"fmt"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// PacingThresholdSec is the per-half delta (seconds per 500m) above
// which we flag a positive/negative split. Anything within ±this is
// considered an even split.
const PacingThresholdSec = 2.0

// DetectPacing compares the mean split of the first vs second half
// of the session. Returns (Finding, true) on success, or (_, false)
// when the input is too short to evaluate (≤1 bucket).
func DetectPacing(s *event.SessionSamples) (Finding, bool) {
	if s == nil || len(s.Split) < 2 {
		return Finding{}, false
	}
	mid := len(s.Split) / 2
	h1 := meanInt(s.Split[:mid])
	h2 := meanInt(s.Split[mid:])
	delta := h2 - h1

	var code Code
	var sev Severity
	var msg string
	switch {
	case delta > PacingThresholdSec:
		code, sev = CodePositiveSplit, SeverityNotable
		msg = fmt.Sprintf(
			"Positiver Split: Zweite Hälfte im Schnitt %ss langsamer als die erste (%s → %s).",
			FormatDecimal(delta, 1), FormatSplit(h1), FormatSplit(h2),
		)
	case delta < -PacingThresholdSec:
		code, sev = CodeNegativeSplit, SeverityInfo
		msg = fmt.Sprintf(
			"Negativer Split: Steigerung um %ss in der zweiten Hälfte (%s → %s).",
			FormatDecimal(-delta, 1), FormatSplit(h1), FormatSplit(h2),
		)
	default:
		code, sev = CodeEvenSplit, SeverityInfo
		msg = fmt.Sprintf(
			"Gleichmäßiges Tempo über beide Hälften (%s / %s).",
			FormatSplit(h1), FormatSplit(h2),
		)
	}

	return Finding{
		DetectorID: "pacing",
		Code:       code,
		Severity:   sev,
		Category:   CategoryPacing,
		MessageDE:  msg,
		Evidence: map[string]float64{
			"h1":    h1,
			"h2":    h2,
			"delta": delta,
		},
	}, true
}

func meanInt(xs []int) float64 {
	if len(xs) == 0 {
		return 0
	}
	var sum int
	for _, x := range xs {
		sum += x
	}
	return float64(sum) / float64(len(xs))
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd backend && go test ./internal/insights/... -run Pacing -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/insights/pacing.go backend/internal/insights/pacing_test.go
git commit -m "feat(insights): PacingDetector — positive/negative/even split"
```

---

### Task 5: FadeDetector

**Files:**
- Create: `backend/internal/insights/fade.go`
- Create: `backend/internal/insights/fade_test.go`

- [ ] **Step 1: Write failing tests**

```go
package insights

import (
	"math"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

func samplesFromWatts(watts []int) *event.SessionSamples {
	s := &event.SessionSamples{Watt: watts}
	for i := range watts {
		s.T = append(s.T, float64(i+1))
		s.Split = append(s.Split, 120)
		s.SPM = append(s.SPM, 22)
		s.DPS = append(s.DPS, 9.0)
		s.SPI = append(s.SPI, 9)
	}
	return s
}

func TestFadeFlagged(t *testing.T) {
	// 10 buckets; mean ~200, last 20% (2 buckets) mean ~185 → 7.5% drop.
	s := samplesFromWatts([]int{215, 210, 205, 205, 200, 200, 198, 195, 190, 183})
	f, ok := DetectFade(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeFade {
		t.Fatalf("code = %q, want FADE", f.Code)
	}
	if f.Severity != SeverityAttention {
		t.Errorf("severity = %q, want ATTENTION", f.Severity)
	}
	if f.Evidence["pct"] < 5.0 {
		t.Errorf("pct = %v, want ≥5", f.Evidence["pct"])
	}
	if !math.Signbit(0) { // sanity
		t.Skip()
	}
}

func TestFadeBelowThresholdNoFinding(t *testing.T) {
	// Steady watts → no fade.
	s := samplesFromWatts([]int{200, 200, 200, 200, 200, 200, 200, 200, 200, 200})
	if _, ok := DetectFade(s); ok {
		t.Fatal("expected no finding for steady session")
	}
}

func TestFadeShortSamplesSkip(t *testing.T) {
	if _, ok := DetectFade(&event.SessionSamples{Watt: []int{200}}); ok {
		t.Fatal("expected no finding on too-short samples")
	}
}
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd backend && go test ./internal/insights/... -run Fade -v`
Expected: FAIL — `DetectFade` undefined.

- [ ] **Step 3: Implement**

```go
package insights

import (
	"fmt"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// FadePct is the percentage drop in mean watts (final 20% segment vs
// session mean) above which we flag a fade.
const FadePct = 5.0

// FadeFinalFraction is the trailing fraction of buckets used as the
// "final segment" in the fade calculation.
const FadeFinalFraction = 0.20

// DetectFade flags a watt drop in the trailing FadeFinalFraction of
// the session. Severity is ATTENTION (it's actionable) once
// triggered.
func DetectFade(s *event.SessionSamples) (Finding, bool) {
	if s == nil || len(s.Watt) < 5 {
		return Finding{}, false
	}
	avg := meanInt(s.Watt)
	if avg <= 0 {
		return Finding{}, false
	}
	tail := int(float64(len(s.Watt)) * FadeFinalFraction)
	if tail < 1 {
		tail = 1
	}
	final := meanInt(s.Watt[len(s.Watt)-tail:])
	dropPct := (avg - final) / avg * 100
	if dropPct < FadePct {
		return Finding{}, false
	}
	msg := fmt.Sprintf(
		"Leistungsabfall von %s%% im Schlussabschnitt (%dW Schnitt → %dW).",
		FormatDecimal(dropPct, 1), int(avg+0.5), int(final+0.5),
	)
	return Finding{
		DetectorID: "fade",
		Code:       CodeFade,
		Severity:   SeverityAttention,
		Category:   CategoryEfficiency,
		MessageDE:  msg,
		Evidence: map[string]float64{
			"avg":   avg,
			"final": final,
			"pct":   dropPct,
		},
	}, true
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd backend && go test ./internal/insights/... -run Fade -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/insights/fade.go backend/internal/insights/fade_test.go
git commit -m "feat(insights): FadeDetector — final-segment watt drop"
```

---

### Task 6: ConsistencyDetector

**Files:**
- Create: `backend/internal/insights/consistency.go`
- Create: `backend/internal/insights/consistency_test.go`

- [ ] **Step 1: Write failing tests**

```go
package insights

import (
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

func TestConsistencyVeryEven(t *testing.T) {
	// CV ~1% (tightly clustered around 120).
	s := samplesFromSplits([]int{119, 120, 120, 121, 120, 119, 120, 121, 120, 120})
	f, ok := DetectConsistency(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeConsistentHigh {
		t.Fatalf("code = %q, want CONSISTENT_HIGH", f.Code)
	}
	if f.Severity != SeverityInfo {
		t.Errorf("severity = %q, want INFO", f.Severity)
	}
}

func TestConsistencyMid(t *testing.T) {
	// CV in [2,5)%.
	s := samplesFromSplits([]int{115, 118, 120, 122, 124, 122, 120, 118, 116, 120})
	f, ok := DetectConsistency(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeConsistentMid {
		t.Fatalf("code = %q, want CONSISTENT_MID, msg=%q cv=%v", f.Code, f.MessageDE, f.Evidence["cv"])
	}
}

func TestConsistencyInconsistent(t *testing.T) {
	// CV ≥ 5%.
	s := samplesFromSplits([]int{100, 130, 110, 135, 105, 128, 115, 140, 108, 125})
	f, ok := DetectConsistency(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeInconsistent {
		t.Fatalf("code = %q, want INCONSISTENT", f.Code)
	}
	if f.Severity != SeverityNotable {
		t.Errorf("severity = %q, want NOTABLE", f.Severity)
	}
}

func TestConsistencyShortSkip(t *testing.T) {
	if _, ok := DetectConsistency(&event.SessionSamples{Split: []int{120}}); ok {
		t.Fatal("expected no finding on too-short samples")
	}
}
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd backend && go test ./internal/insights/... -run Consistency -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```go
package insights

import (
	"fmt"
	"math"

	"github.com/gloeckner-daniel/splits/internal/event"
)

const (
	// CVHigh is the upper edge of "sehr gleichmäßig" (very even).
	CVHigh = 2.0
	// CVMid is the upper edge of "gleichmäßig"; above → "ungleichmäßig".
	CVMid = 5.0
)

// DetectConsistency reports the coefficient of variation of the split
// series, bucketed into three labels.
func DetectConsistency(s *event.SessionSamples) (Finding, bool) {
	if s == nil || len(s.Split) < 3 {
		return Finding{}, false
	}
	mean := meanInt(s.Split)
	if mean <= 0 {
		return Finding{}, false
	}
	var sumSq float64
	for _, v := range s.Split {
		d := float64(v) - mean
		sumSq += d * d
	}
	std := math.Sqrt(sumSq / float64(len(s.Split)))
	cv := std / mean * 100

	var code Code
	var sev Severity
	var label string
	switch {
	case cv < CVHigh:
		code, sev, label = CodeConsistentHigh, SeverityInfo, "sehr gleichmäßig"
	case cv < CVMid:
		code, sev, label = CodeConsistentMid, SeverityInfo, "gleichmäßig"
	default:
		code, sev, label = CodeInconsistent, SeverityNotable, "ungleichmäßig"
	}
	msg := fmt.Sprintf("Tempokonstanz: %s (Split-Variation %s%%).", label, FormatDecimal(cv, 1))

	return Finding{
		DetectorID: "consistency",
		Code:       code,
		Severity:   sev,
		Category:   CategoryConsistency,
		MessageDE:  msg,
		Evidence: map[string]float64{
			"cv":   cv,
			"mean": mean,
			"std":  std,
		},
	}, true
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd backend && go test ./internal/insights/... -run Consistency -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/insights/consistency.go backend/internal/insights/consistency_test.go
git commit -m "feat(insights): ConsistencyDetector — split CV bucketing"
```

---

### Task 7: Eligibility Gate

**Files:**
- Create: `backend/internal/insights/eligibility.go`
- Create: `backend/internal/insights/eligibility_test.go`

- [ ] **Step 1: Write failing tests**

```go
package insights

import "testing"

func TestEligibleStandardSession(t *testing.T) {
	r := CheckEligibility(SessionMeta{
		WorkoutMode: "distance",
		DurationSec: 600,
		DistanceM:   2480,
	})
	if !r.OK {
		t.Fatalf("expected eligible, got reason=%q", r.Reason)
	}
}

func TestNotEligibleIntervals(t *testing.T) {
	r := CheckEligibility(SessionMeta{
		WorkoutMode: "intervals",
		DurationSec: 1200,
		DistanceM:   3000,
	})
	if r.OK || r.Reason != ReasonIntervals {
		t.Fatalf("got OK=%v reason=%q", r.OK, r.Reason)
	}
}

func TestNotEligibleTooShort(t *testing.T) {
	cases := []SessionMeta{
		{WorkoutMode: "distance", DurationSec: 200, DistanceM: 1500},
		{WorkoutMode: "just_row", DurationSec: 600, DistanceM: 800},
	}
	for _, m := range cases {
		r := CheckEligibility(m)
		if r.OK || r.Reason != ReasonTooShort {
			t.Errorf("got OK=%v reason=%q for %+v", r.OK, r.Reason, m)
		}
	}
}

func TestEligibleEmptyWorkoutMode(t *testing.T) {
	// Sessions without an attached workout (legacy / just-row direct).
	r := CheckEligibility(SessionMeta{
		WorkoutMode: "",
		DurationSec: 600,
		DistanceM:   1500,
	})
	if !r.OK {
		t.Fatalf("expected eligible, got reason=%q", r.Reason)
	}
}
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd backend && go test ./internal/insights/... -run Eligib -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```go
package insights

const (
	MinDurationSec = 300  // 5 min
	MinDistanceM   = 1000 // 1 km
)

type Reason string

const (
	ReasonNone      Reason = ""
	ReasonIntervals Reason = "intervals"
	ReasonTooShort  Reason = "too_short"
)

// SessionMeta is the minimum subset of a session needed by the
// eligibility gate. WorkoutMode == "" means "no workout attached".
type SessionMeta struct {
	WorkoutMode string
	DurationSec float64
	DistanceM   int
}

type EligibilityResult struct {
	OK     bool
	Reason Reason
}

func CheckEligibility(m SessionMeta) EligibilityResult {
	if m.WorkoutMode == "intervals" {
		return EligibilityResult{OK: false, Reason: ReasonIntervals}
	}
	if m.DurationSec < MinDurationSec || m.DistanceM < MinDistanceM {
		return EligibilityResult{OK: false, Reason: ReasonTooShort}
	}
	return EligibilityResult{OK: true, Reason: ReasonNone}
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd backend && go test ./internal/insights/... -run Eligib -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/insights/eligibility.go backend/internal/insights/eligibility_test.go
git commit -m "feat(insights): eligibility gate — intervals/short skip"
```

---

### Task 8: Synthesis

**Files:**
- Create: `backend/internal/insights/synthesis.go`
- Create: `backend/internal/insights/synthesis_test.go`

- [ ] **Step 1: Write failing tests**

```go
package insights

import "testing"

func TestSynthesizeEmpty(t *testing.T) {
	if got := Synthesize(nil); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestSynthesizeSingleFinding(t *testing.T) {
	got := Synthesize([]Finding{
		{Code: CodeFade, Severity: SeverityAttention, MessageDE: "Leistungsabfall."},
	})
	if got != "Leistungsabfall." {
		t.Errorf("got %q", got)
	}
}

func TestSynthesizeOrdersBySeverity(t *testing.T) {
	got := Synthesize([]Finding{
		{Code: CodeConsistentHigh, Severity: SeverityInfo, MessageDE: "C."},
		{Code: CodeFade, Severity: SeverityAttention, MessageDE: "F."},
		{Code: CodePositiveSplit, Severity: SeverityNotable, MessageDE: "P."},
	})
	if got != "F. P. C." {
		t.Errorf("got %q", got)
	}
}

func TestSynthesizeUsesEmDashConnective(t *testing.T) {
	got := Synthesize([]Finding{
		{Code: CodePositiveSplit, Severity: SeverityNotable, MessageDE: "Positiver Split."},
		{Code: CodeFade, Severity: SeverityAttention, MessageDE: "Leistungsabfall."},
	})
	// FADE wins on severity, dashed connective with POSITIVE_SPLIT.
	if got != "Leistungsabfall. — Positiver Split." {
		t.Errorf("got %q", got)
	}
}

func TestSynthesizeCapsAtThree(t *testing.T) {
	got := Synthesize([]Finding{
		{Code: CodeFade, Severity: SeverityAttention, MessageDE: "A."},
		{Code: CodePositiveSplit, Severity: SeverityNotable, MessageDE: "B."},
		{Code: CodeInconsistent, Severity: SeverityNotable, MessageDE: "C."},
		{Code: CodeEvenSplit, Severity: SeverityInfo, MessageDE: "D."},
	})
	if got != "A. B. C." {
		t.Errorf("got %q", got)
	}
}
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd backend && go test ./internal/insights/... -run Synthesize -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```go
package insights

import (
	"sort"
	"strings"
)

const synthesisCap = 3

var severityRank = map[Severity]int{
	SeverityAttention: 0,
	SeverityNotable:   1,
	SeverityInfo:      2,
}

// dashedPairs lists ordered Code pairs (a, b) where joining the
// b-message after the a-message uses an em-dash connective. Pair
// order follows already-severity-sorted output.
var dashedPairs = map[[2]Code]bool{
	{CodeFade, CodePositiveSplit}:  true,
	{CodeFade, CodeInconsistent}:   true,
	{CodePositiveSplit, CodeFade}:  true,
	{CodePositiveSplit, CodeInconsistent}: true,
}

// Synthesize joins the top-N findings into a single German paragraph.
// Sorted by severity (ATTENTION > NOTABLE > INFO), capped at 3.
func Synthesize(findings []Finding) string {
	if len(findings) == 0 {
		return ""
	}
	sorted := make([]Finding, len(findings))
	copy(sorted, findings)
	sort.SliceStable(sorted, func(i, j int) bool {
		return severityRank[sorted[i].Severity] < severityRank[sorted[j].Severity]
	})
	if len(sorted) > synthesisCap {
		sorted = sorted[:synthesisCap]
	}
	var b strings.Builder
	b.WriteString(sorted[0].MessageDE)
	for i := 1; i < len(sorted); i++ {
		prev, cur := sorted[i-1].Code, sorted[i].Code
		if dashedPairs[[2]Code{prev, cur}] {
			b.WriteString(" — ")
		} else {
			b.WriteString(" ")
		}
		b.WriteString(sorted[i].MessageDE)
	}
	return b.String()
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd backend && go test ./internal/insights/... -run Synthesize -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/insights/synthesis.go backend/internal/insights/synthesis_test.go
git commit -m "feat(insights): synthesis paragraph — severity-sorted, dashed pairs"
```

---

### Task 9: Run Orchestrator

**Files:**
- Create: `backend/internal/insights/run.go`
- Create: `backend/internal/insights/run_test.go`

- [ ] **Step 1: Write failing tests**

```go
package insights

import (
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

func TestRunSkippedIneligible(t *testing.T) {
	res := Run(SessionMeta{WorkoutMode: "intervals", DurationSec: 600, DistanceM: 2000}, &event.SessionSamples{})
	if res.Eligible {
		t.Fatal("expected ineligible")
	}
	if res.Reason != ReasonIntervals {
		t.Errorf("reason = %q", res.Reason)
	}
	if len(res.Findings) != 0 {
		t.Errorf("findings = %d, want 0", len(res.Findings))
	}
	if res.SynthesisDE != "" {
		t.Errorf("synthesis = %q", res.SynthesisDE)
	}
}

func TestRunStandardSession(t *testing.T) {
	splits := []int{118, 119, 120, 120, 121, 121, 122, 123, 124, 126}
	watts := []int{215, 210, 205, 205, 200, 200, 198, 195, 190, 183}
	s := &event.SessionSamples{Split: splits, Watt: watts}
	for i := range splits {
		s.T = append(s.T, float64(i+1))
		s.SPM = append(s.SPM, 22)
		s.DPS = append(s.DPS, 9.0)
		s.SPI = append(s.SPI, 9)
	}
	res := Run(SessionMeta{WorkoutMode: "distance", DurationSec: 600, DistanceM: 2480}, s)
	if !res.Eligible {
		t.Fatalf("expected eligible, reason=%q", res.Reason)
	}
	codes := map[Code]bool{}
	for _, f := range res.Findings {
		codes[f.Code] = true
	}
	for _, want := range []Code{CodePositiveSplit, CodeFade} {
		if !codes[want] {
			t.Errorf("missing finding %q", want)
		}
	}
	if res.SynthesisDE == "" {
		t.Error("expected synthesis text")
	}
}
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd backend && go test ./internal/insights/... -run Run -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```go
package insights

import "github.com/gloeckner-daniel/splits/internal/event"

// Result is the full output of a run: either a list of findings + a
// synthesis paragraph, or an ineligibility reason.
type Result struct {
	Eligible    bool      `json:"eligible"`
	Reason      Reason    `json:"reason,omitempty"`
	Findings    []Finding `json:"findings"`
	SynthesisDE string    `json:"synthesis_de"`
}

// Run executes the eligibility gate and (if eligible) every detector
// over the supplied samples, then synthesises a paragraph. Pure —
// no IO. Caller persists the result.
func Run(meta SessionMeta, samples *event.SessionSamples) Result {
	gate := CheckEligibility(meta)
	if !gate.OK {
		return Result{Eligible: false, Reason: gate.Reason, Findings: []Finding{}}
	}
	var findings []Finding
	if f, ok := DetectPacing(samples); ok {
		findings = append(findings, f)
	}
	if f, ok := DetectFade(samples); ok {
		findings = append(findings, f)
	}
	if f, ok := DetectConsistency(samples); ok {
		findings = append(findings, f)
	}
	return Result{
		Eligible:    true,
		Findings:    findings,
		SynthesisDE: Synthesize(findings),
	}
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd backend && go test ./internal/insights/... -v`
Expected: All PASS (entire package).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/insights/run.go backend/internal/insights/run_test.go
git commit -m "feat(insights): Run orchestrator — eligibility + detectors + synthesis"
```

---

### Task 10: Store

**Files:**
- Create: `backend/internal/insights/store.go`
- Create: `backend/internal/insights/store_test.go`

The test pattern follows `backend/internal/storage/persister_test.go`
and `backend/internal/stats/recompute_test.go` — open an in-memory
SQLite via `storage.OpenMemory(t)` (existing helper) and apply
migrations.

- [ ] **Step 1: Inspect existing test helper**

Run: `cd backend && grep -rn "OpenMemory\|MustOpen\|setupDB" internal/storage internal/stats | head -10`
Expected: identifies the test-DB-open helper. Use it; do NOT roll a new one.

- [ ] **Step 2: Write failing tests**

(Adjust `OpenMemory` symbol name to whatever Step 1 turned up.)

```go
package insights

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/storage"
)

func TestStoreInsertAndList(t *testing.T) {
	db := storage.OpenMemory(t) // adjust to actual helper

	rowerID := "r1"
	sessionID := "s1"
	// Seed minimal session row so FK holds.
	storage.MustExec(t, db, `INSERT INTO rowers(id,name,created_at) VALUES (?,?,?)`,
		rowerID, "R", time.Now().UTC().Format(time.RFC3339Nano))
	storage.MustExec(t, db, `
		INSERT INTO sessions(id, rower_id, started_at, ended_at)
		VALUES (?, ?, ?, ?)`,
		sessionID, rowerID,
		time.Now().UTC().Format(time.RFC3339Nano),
		time.Now().UTC().Format(time.RFC3339Nano))

	store := NewStore(db)
	findings := []Finding{
		{
			DetectorID: "pacing", Code: CodePositiveSplit,
			Severity: SeverityNotable, Category: CategoryPacing,
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
	if len(got) != 1 || got[0].Code != CodePositiveSplit {
		t.Fatalf("got %+v", got)
	}
	if got[0].Evidence["delta"] != 3.6 {
		t.Errorf("evidence delta = %v", got[0].Evidence["delta"])
	}
}

func TestStoreReplaceIsIdempotent(t *testing.T) {
	db := storage.OpenMemory(t)
	rowerID, sessionID := "r1", "s1"
	storage.MustExec(t, db, `INSERT INTO rowers(id,name,created_at) VALUES (?,?,?)`,
		rowerID, "R", time.Now().UTC().Format(time.RFC3339Nano))
	storage.MustExec(t, db, `INSERT INTO sessions(id,rower_id,started_at,ended_at) VALUES (?,?,?,?)`,
		sessionID, rowerID,
		time.Now().UTC().Format(time.RFC3339Nano),
		time.Now().UTC().Format(time.RFC3339Nano))

	store := NewStore(db)
	f := []Finding{{DetectorID: "pacing", Code: CodeEvenSplit, Severity: SeverityInfo, Category: CategoryPacing, MessageDE: "x", Evidence: map[string]float64{}}}
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
```

- [ ] **Step 3: Run tests, expect FAIL**

Run: `cd backend && go test ./internal/insights/... -run Store -v`
Expected: FAIL — `NewStore` undefined.

- [ ] **Step 4: Implement**

```go
package insights

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

type Store struct{ db *sql.DB }

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// ReplaceForSession deletes any existing rows for sessionID and
// inserts the supplied findings in a single transaction. Used at
// session_end and for backfill.
func (s *Store) ReplaceForSession(ctx context.Context, rowerID, sessionID string, findings []Finding) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := ReplaceForSessionTx(ctx, tx, rowerID, sessionID, findings); err != nil {
		return err
	}
	return tx.Commit()
}

// ReplaceForSessionTx is the transactional variant — used by
// applySessionEnd which already holds a tx.
func ReplaceForSessionTx(ctx context.Context, tx *sql.Tx, rowerID, sessionID string, findings []Finding) error {
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM session_insights WHERE session_id = ?`, sessionID); err != nil {
		return err
	}
	if len(findings) == 0 {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO session_insights
		  (rower_id, session_id, detector_id, code, severity, category, message_de, evidence_json, computed_at)
		VALUES (?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, f := range findings {
		ev, err := json.Marshal(f.Evidence)
		if err != nil {
			return err
		}
		if _, err := stmt.ExecContext(ctx,
			rowerID, sessionID, f.DetectorID, string(f.Code),
			string(f.Severity), string(f.Category), f.MessageDE, string(ev), now); err != nil {
			return err
		}
	}
	return nil
}

// ListForSession returns findings ordered by severity (ATTENTION first).
func (s *Store) ListForSession(ctx context.Context, sessionID string) ([]Finding, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT detector_id, code, severity, category, message_de, evidence_json
		FROM session_insights
		WHERE session_id = ?
		ORDER BY CASE severity
		           WHEN 'ATTENTION' THEN 0
		           WHEN 'NOTABLE'   THEN 1
		           ELSE 2 END,
		         id ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var f Finding
		var sev, cat, code, ev string
		if err := rows.Scan(&f.DetectorID, &code, &sev, &cat, &f.MessageDE, &ev); err != nil {
			return nil, err
		}
		f.Code = Code(code)
		f.Severity = Severity(sev)
		f.Category = Category(cat)
		f.Evidence = map[string]float64{}
		if ev != "" {
			if err := json.Unmarshal([]byte(ev), &f.Evidence); err != nil {
				return nil, err
			}
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `cd backend && go test ./internal/insights/... -v`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/insights/store.go backend/internal/insights/store_test.go
git commit -m "feat(insights): Store — replace + list, idempotent"
```

---

### Task 11: Hook into Session-End Persister

**Files:**
- Modify: `backend/internal/storage/persister.go` (around line 218 — where samples are computed)

The hook runs INSIDE the same transaction as `UpdateSessionEndWithEventID`,
so a failed insights write rolls back the whole session-end. To stay
robust, we intentionally swallow detector panics via `defer/recover`
in a wrapper, but DB write errors still abort.

- [ ] **Step 1: Read current applySessionEnd**

Read: `backend/internal/storage/persister.go:205-243`. Confirm structure
matches the snippet in this plan.

- [ ] **Step 2: Add insights wiring**

Add helper at end of `persister.go`:

```go
// computeInsightsSafely runs the insights pipeline with panic
// recovery. A panic in a detector logs and returns an empty result;
// the session_end commit still succeeds without insights.
func computeInsightsSafely(meta insights.SessionMeta, samples *event.SessionSamples) (res insights.Result) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("insights.compute panic", "err", r)
			res = insights.Result{Eligible: false, Findings: []insights.Finding{}}
		}
	}()
	return insights.Run(meta, samples)
}
```

Add imports at the top:

```go
"log/slog"
"github.com/gloeckner-daniel/splits/internal/insights"
```

Modify `applySessionEnd` to (a) load workout mode, (b) compute findings,
(c) replace within the existing tx. Replace lines 211-243 with:

```go
func (p *Persister) applySessionEnd(ctx context.Context, e event.Event) error {
	strokes, err := LoadSessionStrokes(ctx, p.DB, e.SessionID)
	if err != nil {
		return err
	}
	workStrokes := filterWorkStrokes(strokes)
	summary := e.SessionEnd.Summary
	summary.Samples = stats.ComputeSamples(workStrokes, stats.DefaultBucketStrokes)
	summary.PBCandidates = stats.ComputeCandidates(workStrokes)

	// Pre-load workout mode + rower_id for insights eligibility.
	var rowerID, workoutMode string
	_ = p.DB.QueryRowContext(ctx, `
		SELECT s.rower_id, COALESCE(w.mode, '')
		FROM sessions s
		LEFT JOIN workouts w ON w.id = s.workout_id
		WHERE s.id = ?`, e.SessionID).Scan(&rowerID, &workoutMode)

	insightsRes := computeInsightsSafely(insights.SessionMeta{
		WorkoutMode: workoutMode,
		DurationSec: summary.TotalTimeSec,
		DistanceM:   summary.TotalDistanceM,
	}, summary.Samples)

	tx, err := p.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := UpdateSessionEndWithEventID(ctx, tx, e.SessionID, e.SessionEnd.EndedAt, summary, e.ID); err != nil {
		return err
	}
	if err := DeleteSessionStrokes(ctx, tx, e.SessionID); err != nil {
		return err
	}
	if rowerID != "" {
		if err := insights.ReplaceForSessionTx(ctx, tx, rowerID, e.SessionID, insightsRes.Findings); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if p.Scheduler != nil && rowerID != "" {
		stats.OnSessionChange(p.Scheduler, rowerID, stats.SessionCreated)
	}
	return nil
}
```

- [ ] **Step 3: Verify build + tests**

Run: `cd backend && go build ./... && go test ./internal/storage/... -v -run SessionEnd`
Expected: PASS — existing persister tests unaffected, insights call is in-place.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/storage/persister.go
git commit -m "feat(insights): compute findings inside applySessionEnd"
```

---

### Task 12: API Handler

**Files:**
- Create: `backend/internal/api/insights.go`
- Create: `backend/internal/api/insights_test.go`
- Modify: `backend/internal/api/sessions.go` (route registration around line 33)

- [ ] **Step 1: Inspect existing session-detail handler shape**

Read: `backend/internal/api/sessions.go:55-90`. Note JSON shape +
error handling pattern (likely `apiError(w, ...)` or similar). Mirror it.

- [ ] **Step 2: Write failing test**

```go
package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/insights"
)

func TestGetSessionInsights(t *testing.T) {
	srv, db, rowerID, sessionID := setupAPITest(t) // existing test helper
	defer srv.Close()

	store := insights.NewStore(db)
	store.ReplaceForSession(t.Context(), rowerID, sessionID, []insights.Finding{
		{DetectorID: "pacing", Code: insights.CodePositiveSplit,
			Severity: insights.SeverityNotable, Category: insights.CategoryPacing,
			MessageDE: "Positiver Split.",
			Evidence:  map[string]float64{"delta": 3.6}},
	})

	r, _ := http.NewRequest("GET", srv.URL+"/api/v1/sessions/"+sessionID+"/insights", nil)
	resp, err := srv.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var body struct {
		Findings    []insights.Finding `json:"findings"`
		SynthesisDE string             `json:"synthesis_de"`
		Reason      string             `json:"reason"`
	}
	json.NewDecoder(resp.Body).Decode(&body)
	if len(body.Findings) != 1 || body.Findings[0].Code != insights.CodePositiveSplit {
		t.Errorf("findings = %+v", body.Findings)
	}
	if body.SynthesisDE != "Positiver Split." {
		t.Errorf("synthesis = %q", body.SynthesisDE)
	}
}

func TestGetSessionInsightsNotFound(t *testing.T) {
	srv, _, _, _ := setupAPITest(t)
	defer srv.Close()
	r, _ := http.NewRequest("GET", srv.URL+"/api/v1/sessions/nonexistent/insights", nil)
	resp, _ := srv.Client().Do(r)
	if resp.StatusCode != 404 {
		t.Errorf("want 404, got %d", resp.StatusCode)
	}
}
```

(`setupAPITest` is the existing helper — find via `grep -n "setupAPITest\|newTestServer" internal/api/*_test.go`. Use whatever it's called and adapt the seeding.)

- [ ] **Step 3: Run test, expect FAIL**

Run: `cd backend && go test ./internal/api/... -run Insights -v`
Expected: FAIL — handler not registered.

- [ ] **Step 4: Implement handler**

Create `backend/internal/api/insights.go`:

```go
package api

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gloeckner-daniel/splits/internal/insights"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

func getSessionInsights(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		row, err := storage.GetSession(r.Context(), db, id)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if row == nil {
			writeJSONError(w, http.StatusNotFound, "session not found")
			return
		}
		store := insights.NewStore(db)
		findings, err := store.ListForSession(r.Context(), id)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		body := map[string]any{
			"findings":     findings,
			"synthesis_de": insights.Synthesize(findings),
		}
		// Reason populated only when no findings AND ineligible. We
		// recompute eligibility for the read path so the UI can show
		// the right placeholder without persisting "reason" in the
		// table.
		if len(findings) == 0 {
			meta := insights.SessionMeta{
				WorkoutMode: row.WorkoutMode, // ensure GetSession returns it; Step 5 below.
				DurationSec: row.TotalTimeSec,
				DistanceM:   row.TotalDistanceM,
			}
			res := insights.CheckEligibility(meta)
			if !res.OK {
				body["reason"] = string(res.Reason)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	}
}

// writeJSONError mirrors the existing error helper in this package.
// If a different name exists (e.g. apiError), use it instead.
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
```

- [ ] **Step 5: Ensure `storage.GetSession` exposes WorkoutMode**

Inspect: `grep -n "type SessionRow\|WorkoutMode\|workout_id" backend/internal/storage/sessions.go`.

If `GetSession` doesn't already return workout mode, extend the
SELECT (LEFT JOIN workouts) and add `WorkoutMode string` to the
returned struct. If it already does, skip this step.

If a change is needed, write/extend a unit test in
`backend/internal/storage/sessions_test.go` that asserts the
returned struct's WorkoutMode for an intervals session before
implementing.

- [ ] **Step 6: Wire route**

Modify `backend/internal/api/sessions.go` near line 33:

```go
mux.HandleFunc("GET /api/v1/sessions/{id}/insights", getSessionInsights(db))
```

- [ ] **Step 7: Run test, expect PASS**

Run: `cd backend && go test ./internal/api/... -run Insights -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/api/insights.go backend/internal/api/insights_test.go backend/internal/api/sessions.go backend/internal/storage/sessions.go backend/internal/storage/sessions_test.go
git commit -m "feat(insights): GET /api/v1/sessions/{id}/insights"
```

---

### Task 13: Backfill Command

**Files:**
- Create: `backend/cmd/insights-backfill/main.go`

- [ ] **Step 1: Implement**

```go
// Command insights-backfill runs the FEAT-0011 insights pipeline
// against every session that already has summary_json populated.
// Idempotent: ReplaceForSession deletes-then-inserts.
//
// Usage: insights-backfill -db /path/to/splits.db
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"

	_ "modernc.org/sqlite"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/insights"
)

func main() {
	dbPath := flag.String("db", "", "Path to splits.db")
	flag.Parse()
	if *dbPath == "" {
		fmt.Fprintln(os.Stderr, "missing -db")
		os.Exit(2)
	}
	db, err := sql.Open("sqlite", *dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	rows, err := db.QueryContext(context.Background(), `
		SELECT s.id, s.rower_id, COALESCE(w.mode, ''),
		       s.total_time_sec, s.total_distance_m, s.summary_json
		FROM sessions s
		LEFT JOIN workouts w ON w.id = s.workout_id
		WHERE s.ended_at IS NOT NULL AND s.summary_json IS NOT NULL`)
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	store := insights.NewStore(db)
	var done, skipped, errored int
	for rows.Next() {
		var id, rowerID, mode, summary string
		var dur float64
		var dist int
		if err := rows.Scan(&id, &rowerID, &mode, &dur, &dist, &summary); err != nil {
			log.Printf("scan: %v", err)
			errored++
			continue
		}
		var parsed struct {
			Samples *event.SessionSamples `json:"samples"`
		}
		if err := json.Unmarshal([]byte(summary), &parsed); err != nil || parsed.Samples == nil {
			skipped++
			continue
		}
		res := insights.Run(insights.SessionMeta{
			WorkoutMode: mode,
			DurationSec: dur,
			DistanceM:   dist,
		}, parsed.Samples)
		if err := store.ReplaceForSession(context.Background(), rowerID, id, res.Findings); err != nil {
			log.Printf("replace %s: %v", id, err)
			errored++
			continue
		}
		done++
	}
	log.Printf("backfill done: %d processed, %d skipped, %d errored", done, skipped, errored)
}
```

- [ ] **Step 2: Verify build**

Run: `cd backend && go build ./cmd/insights-backfill/...`
Expected: success.

- [ ] **Step 3: Smoke run on dev DB**

Run: `cd backend && go run ./cmd/insights-backfill -db ./dev.db`
Expected: log line `backfill done: N processed, ...`. Spot-check
with `sqlite3 backend/dev.db "SELECT COUNT(*) FROM session_insights;"`.

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/insights-backfill/main.go
git commit -m "feat(insights): one-shot backfill cmd over existing sessions"
```

---

### Task 14: Web API Client

**Files:**
- Create: `web/src/api/insights.ts`
- Create: `web/src/api/insights.test.ts`

- [ ] **Step 1: Inspect existing client style**

Read: `web/src/api/rowers.ts:1-50`. Reuse `apiFetch` + `json<T>` helpers.

- [ ] **Step 2: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSessionInsights } from './insights'

describe('insights api', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parses findings + synthesis', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      findings: [{
        detector_id: 'pacing', code: 'POSITIVE_SPLIT',
        severity: 'NOTABLE', category: 'PACING',
        message_de: 'Positiver Split.', evidence: { delta: 3.6 },
      }],
      synthesis_de: 'Positiver Split.',
    }), { status: 200 }))
    const r = await getSessionInsights('s1')
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].code).toBe('POSITIVE_SPLIT')
    expect(r.synthesisDe).toBe('Positiver Split.')
  })

  it('returns reason when ineligible', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      findings: [], synthesis_de: '', reason: 'intervals',
    }), { status: 200 }))
    const r = await getSessionInsights('s1')
    expect(r.findings).toHaveLength(0)
    expect(r.reason).toBe('intervals')
  })
})
```

- [ ] **Step 3: Run test, expect FAIL**

Run: `cd web && npm test -- insights.test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
import { apiFetch } from './client'

export type Severity = 'INFO' | 'NOTABLE' | 'ATTENTION'
export type Category = 'PACING' | 'EFFICIENCY' | 'CONSISTENCY'
export type FindingCode =
  | 'POSITIVE_SPLIT' | 'NEGATIVE_SPLIT' | 'EVEN_SPLIT'
  | 'FADE'
  | 'CONSISTENT_HIGH' | 'CONSISTENT_MID' | 'INCONSISTENT'

export type Finding = {
  detector_id: string
  code: FindingCode
  severity: Severity
  category: Category
  message_de: string
  evidence: Record<string, number>
}

export type InsightsReason = 'intervals' | 'too_short' | undefined

export type Insights = {
  findings: Finding[]
  synthesisDe: string
  reason?: InsightsReason
}

type WireInsights = {
  findings: Finding[]
  synthesis_de: string
  reason?: InsightsReason
}

export async function getSessionInsights(sessionId: string): Promise<Insights> {
  const r = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/insights`)
  if (!r.ok) throw new Error(`insights fetch failed: ${r.status}`)
  const w = (await r.json()) as WireInsights
  return {
    findings: w.findings ?? [],
    synthesisDe: w.synthesis_de ?? '',
    reason: w.reason,
  }
}
```

- [ ] **Step 5: Run test, expect PASS**

Run: `cd web && npm test -- insights.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/insights.ts web/src/api/insights.test.ts
git commit -m "feat(insights): web API client + types"
```

---

### Task 15: FindingCard Component

**Files:**
- Create: `web/src/pages/session/FindingCard.tsx`
- Create: `web/src/pages/session/FindingCard.module.css`
- Create: `web/src/pages/session/FindingCard.test.tsx`

(Note: existing pages live directly in `web/src/pages/`. The `session/`
subfolder is new and exists to keep insights code grouped. If the
codebase rejects this, place files at `web/src/pages/` flat.)

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FindingCard } from './FindingCard'

describe('FindingCard', () => {
  it('renders message and severity-styled wrapper', () => {
    render(<FindingCard finding={{
      detector_id: 'fade',
      code: 'FADE',
      severity: 'ATTENTION',
      category: 'EFFICIENCY',
      message_de: 'Leistungsabfall von 6,8% im Schlussabschnitt.',
      evidence: {},
    }} />)
    expect(screen.getByText(/Leistungsabfall von 6,8/)).toBeInTheDocument()
    const card = screen.getByTestId('finding-card')
    expect(card.dataset.severity).toBe('ATTENTION')
    expect(card.dataset.category).toBe('EFFICIENCY')
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `cd web && npm test -- FindingCard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement CSS**

```css
.card {
  border-radius: 12px;
  padding: 12px 14px;
  background: var(--color-surface);
  border-left: 4px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.card[data-severity="ATTENTION"] { border-left-color: var(--color-warning, #d98700); }
.card[data-severity="NOTABLE"]   { border-left-color: var(--color-accent,  #2b6cb0); }
.card[data-severity="INFO"]      { border-left-color: var(--color-muted,   #888); }

.message { font-size: 0.95rem; line-height: 1.35; }
.label   { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); }
```

- [ ] **Step 4: Implement component**

```tsx
import styles from './FindingCard.module.css'
import type { Finding } from '../../api/insights'

const categoryLabel: Record<Finding['category'], string> = {
  PACING: 'Pacing',
  EFFICIENCY: 'Leistung',
  CONSISTENCY: 'Tempokonstanz',
}

export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div
      className={styles.card}
      data-testid="finding-card"
      data-severity={finding.severity}
      data-category={finding.category}
    >
      <span className={styles.label}>{categoryLabel[finding.category]}</span>
      <p className={styles.message}>{finding.message_de}</p>
    </div>
  )
}
```

- [ ] **Step 5: Run test, expect PASS**

Run: `cd web && npm test -- FindingCard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/session/FindingCard.tsx web/src/pages/session/FindingCard.module.css web/src/pages/session/FindingCard.test.tsx
git commit -m "feat(insights): FindingCard component"
```

---

### Task 16: InsightsSection Component

**Files:**
- Create: `web/src/pages/session/InsightsSection.tsx`
- Create: `web/src/pages/session/InsightsSection.module.css`
- Create: `web/src/pages/session/InsightsSection.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InsightsSection } from './InsightsSection'
import * as api from '../../api/insights'

describe('InsightsSection', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('renders synthesis + cards for eligible session', async () => {
    vi.spyOn(api, 'getSessionInsights').mockResolvedValue({
      findings: [
        { detector_id: 'fade', code: 'FADE', severity: 'ATTENTION', category: 'EFFICIENCY', message_de: 'Leistungsabfall.', evidence: {} },
        { detector_id: 'pacing', code: 'POSITIVE_SPLIT', severity: 'NOTABLE', category: 'PACING', message_de: 'Positiver Split.', evidence: {} },
      ],
      synthesisDe: 'Leistungsabfall. — Positiver Split.',
    })
    render(<InsightsSection sessionId="s1" />)
    expect(await screen.findByText(/Leistungsabfall\. — Positiver Split\./)).toBeInTheDocument()
    expect(screen.getAllByTestId('finding-card')).toHaveLength(2)
  })

  it('renders intervals placeholder', async () => {
    vi.spyOn(api, 'getSessionInsights').mockResolvedValue({
      findings: [], synthesisDe: '', reason: 'intervals',
    })
    render(<InsightsSection sessionId="s1" />)
    expect(await screen.findByText(/Intervalle in Vorbereitung/)).toBeInTheDocument()
  })

  it('renders too-short placeholder', async () => {
    vi.spyOn(api, 'getSessionInsights').mockResolvedValue({
      findings: [], synthesisDe: '', reason: 'too_short',
    })
    render(<InsightsSection sessionId="s1" />)
    expect(await screen.findByText(/zu kurz/i)).toBeInTheDocument()
  })

  it('hides itself silently on fetch error', async () => {
    vi.spyOn(api, 'getSessionInsights').mockRejectedValue(new Error('boom'))
    const { container } = render(<InsightsSection sessionId="s1" />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd web && npm test -- InsightsSection`
Expected: FAIL.

- [ ] **Step 3: Implement CSS**

```css
.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
}
.heading {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  margin: 0;
}
.synthesis {
  font-size: 1.05rem;
  line-height: 1.45;
  margin: 0;
}
.cards {
  display: grid;
  gap: 8px;
}
.placeholder {
  color: var(--color-text-muted);
  font-style: italic;
}
```

- [ ] **Step 4: Implement component**

```tsx
import { useEffect, useState } from 'react'
import styles from './InsightsSection.module.css'
import { getSessionInsights, type Insights } from '../../api/insights'
import { FindingCard } from './FindingCard'

const placeholderForReason: Record<string, string> = {
  intervals: 'Insights für Intervalle in Vorbereitung.',
  too_short: 'Session zu kurz für Auswertung.',
}

export function InsightsSection({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<Insights | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    getSessionInsights(sessionId)
      .then((r) => { if (!cancelled) setData(r) })
      .catch(() => { if (!cancelled) setErrored(true) })
    return () => { cancelled = true }
  }, [sessionId])

  if (errored || !data) return null

  if (data.findings.length === 0) {
    const msg = data.reason ? placeholderForReason[data.reason] : null
    if (!msg) return null
    return (
      <section className={styles.section}>
        <h2 className={styles.heading}>Auswertung</h2>
        <p className={styles.placeholder}>{msg}</p>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Auswertung</h2>
      <p className={styles.synthesis}>{data.synthesisDe}</p>
      <div className={styles.cards}>
        {data.findings.map((f) => (
          <FindingCard key={f.detector_id} finding={f} />
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `cd web && npm test -- InsightsSection`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/session/InsightsSection.tsx web/src/pages/session/InsightsSection.module.css web/src/pages/session/InsightsSection.test.tsx
git commit -m "feat(insights): InsightsSection — synthesis + cards + placeholders"
```

---

### Task 17: Wire into SessionDetailPage

**Files:**
- Modify: `web/src/pages/SessionDetailPage.tsx`
- Modify: `web/src/pages/SessionDetailPage.test.tsx`

- [ ] **Step 1: Inspect SessionDetailPage**

Read: `web/src/pages/SessionDetailPage.tsx`. Locate the area between
the page header (session date/distance/etc) and the charts. Insert
`<InsightsSection sessionId={id} />` there.

- [ ] **Step 2: Add test**

Append to `SessionDetailPage.test.tsx`:

```tsx
import * as api from '../api/insights'
// ...
it('renders insights section between header and charts', async () => {
  vi.spyOn(api, 'getSessionInsights').mockResolvedValue({
    findings: [], synthesisDe: '', reason: 'too_short',
  })
  // ... existing render setup with sessionId 's1'
  expect(await screen.findByText(/Auswertung/)).toBeInTheDocument()
})
```

(If existing tests already mock the session API, mirror their fetch-mocking style.)

- [ ] **Step 3: Add import + render**

```tsx
import { InsightsSection } from './session/InsightsSection'
// ...
{/* between header block and charts */}
<InsightsSection sessionId={id} />
```

- [ ] **Step 4: Run test, expect PASS**

Run: `cd web && npm test -- SessionDetailPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/SessionDetailPage.tsx web/src/pages/SessionDetailPage.test.tsx
git commit -m "feat(insights): render Auswertung section on SessionDetailPage"
```

---

### Task 18: Manual Verification + Backfill on Dev DB

- [ ] **Step 1: Run all tests**

Run: `cd backend && go test ./... && cd ../web && npm test`
Expected: all green.

- [ ] **Step 2: Backfill local dev DB**

Run: `cd backend && go run ./cmd/insights-backfill -db ./dev.db`
Expected: log shows N sessions processed.

Sanity:
```bash
sqlite3 backend/dev.db "SELECT session_id, code, severity FROM session_insights ORDER BY computed_at DESC LIMIT 10;"
```

- [ ] **Step 3: Start dev server, hit endpoint**

Run: `./scripts/backend.sh` (and frontend dev as usual).
Pick a real session id from history. `curl
http://localhost:8080/api/v1/sessions/<id>/insights | jq` and confirm
shape: `{findings: [...], synthesis_de: "..."}` or
`{..., reason: "intervals"}`.

- [ ] **Step 4: Browser verification**

Open Session-Detail for several sessions:

- One steady distance/time session ≥1km, ≥5min → Auswertung block
  with synthesis + 1-3 cards.
- One intervals session → "Insights für Intervalle in Vorbereitung".
- One short Just-Row session (<1km or <5min) → "Session zu kurz für
  Auswertung."

- [ ] **Step 5: Commit any final tweaks + close out**

If everything passes:

```bash
git status   # confirm clean
git log --oneline | head -20   # confirm task commits present
```

---

## Self-Review

**Spec coverage:**
- Migration 0013 → Task 1. ✅
- Three detectors (pacing/fade/consistency) → Tasks 4/5/6. ✅
- Eligibility gate (intervals + 5min/1000m) → Task 7. ✅
- Synthesis (severity-sorted, dashed pairs) → Task 8. ✅
- Self-sufficient rows in `session_insights` → Tasks 1, 10. ✅
- Hook into `applySessionEnd` (instead of OnSessionChange — see note) → Task 11. ✅
- Cascade delete on session removal → ON DELETE CASCADE in migration. ✅
- Idempotent recompute → Task 10 test asserts. ✅
- Backfill for existing sessions → Task 13. ✅
- Server-side German rendering → Tasks 3-6. ✅
- API `GET /sessions/:id/insights` with eligibility reason → Task 12. ✅
- UI Auswertung section between header and charts → Tasks 15-17. ✅
- Manual verification → Task 18. ✅

**Note on architecture deviation:** Spec said "OnSessionChange triggers
insights recompute". Plan computes inline in `applySessionEnd` instead,
because (a) insights are per-session, not per-rower aggregates,
(b) `OnSessionChange` only has Created/HardDeleted/Compacted (delete
already handled by ON DELETE CASCADE; compacted is rare boot-janitor
path). Inline keeps it simple and atomic with summary_json write. If
spec strictness matters, add a tiny `applyOnSessionChange` hook later
— not needed for v1 correctness.

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate ..." lines.
Step 5 of Task 12 conditionally extends `GetSession` — concrete: only
if WorkoutMode isn't already returned, with explicit grep first.

**Type consistency:** `Finding`, `Severity`, `Category`, `Code`,
`SessionMeta`, `Result`, `Store`, `Run` used consistently across Go
tasks. TS `Finding`, `Insights`, `getSessionInsights` consistent
across web tasks.
