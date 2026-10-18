package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/api"
)

func writeState(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "update-state.json")
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// A state file as deploy/splits-update.sh writes it.
func stateFile(state, installed, latest, result string, blocked ...string) string {
	b, _ := json.Marshal(blocked)
	if blocked == nil {
		b = []byte("[]")
	}
	return `{
  "checked_at": "2026-10-19T04:41:07Z",
  "installed": "` + installed + `",
  "previous": "v0.4.0",
  "latest": "` + latest + `",
  "state": "` + state + `",
  "result": "` + result + `",
  "message": "the updater's own words",
  "blocked": ` + string(b) + `
}`
}

// ADR-0023 §4: the five states reach the wire as the updater named them.
func TestReadUpdateStatus_FiveStates(t *testing.T) {
	for _, tc := range []struct {
		name, file, want string
	}{
		{"current", stateFile("current", "v0.4.1", "v0.4.1", "current"), "current"},
		{"behind", stateFile("behind", "v0.4.1", "v0.4.2", "busy"), "behind"},
		{"stuck", stateFile("stuck", "v0.4.1", "v0.4.2", "rolled-back", "v0.4.2"), "stuck"},
		{"off", stateFile("off", "v0.4.1", "", "off"), "off"},
		{"unknown", stateFile("unknown", "", "", "hand-managed"), "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := api.ReadUpdateStatus(writeState(t, tc.file), "v0.4.1")
			if !got.Available || got.State != tc.want {
				t.Fatalf("state = %q (available %v), want %q", got.State, got.Available, tc.want)
			}
			if got.Running != "v0.4.1" {
				t.Errorf("running = %q, want v0.4.1", got.Running)
			}
		})
	}
}

func TestReadUpdateStatus_FieldsPassedThrough(t *testing.T) {
	got := api.ReadUpdateStatus(writeState(t, stateFile("stuck", "v0.4.1", "v0.4.2", "rolled-back", "v0.4.2", "v0.3.9")), "v0.4.1")
	want := api.UpdateStatus{
		Available: true, State: "stuck", Running: "v0.4.1",
		Installed: "v0.4.1", Previous: "v0.4.0", Latest: "v0.4.2",
		CheckedAt: "2026-10-19T04:41:07Z", Result: "rolled-back",
		Message: "the updater's own words", Blocked: []string{"v0.4.2", "v0.3.9"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

func TestReadUpdateStatus_NoFile(t *testing.T) {
	got := api.ReadUpdateStatus(filepath.Join(t.TempDir(), "missing.json"), "dev")
	if got.Available || got.State != "unknown" || got.Running != "dev" || got.Blocked == nil {
		t.Errorf("got %+v, want available=false state=unknown running=dev blocked=[]", got)
	}
}

// The file is read, not believed: garbage, an invented state or tags
// that are not release tags read as unknown.
func TestReadUpdateStatus_DistrustsTheFile(t *testing.T) {
	for _, tc := range []struct{ name, file string }{
		{"not json", "{nope"},
		{"invented state", stateFile("great", "v0.4.1", "v0.4.2", "updated")},
		{"behind without a latest tag", stateFile("behind", "v0.4.1", "nightly", "busy")},
		{"current with a dev slot", stateFile("current", "dev", "v0.4.2", "current")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := api.ReadUpdateStatus(writeState(t, tc.file), "v0.4.1")
			if got.State != "unknown" {
				t.Errorf("state = %q, want unknown", got.State)
			}
		})
	}
	got := api.ReadUpdateStatus(writeState(t, stateFile("stuck", "v0.4.1", "v0.4.2", "Rolled Back!", "v0.4.2", "../etc")), "v0.4.1")
	if got.Result != "" || !reflect.DeepEqual(got.Blocked, []string{"v0.4.2"}) {
		t.Errorf("result = %q blocked = %v, want '' and [v0.4.2]", got.Result, got.Blocked)
	}
}

func TestUpdateStatusHandler_JSON(t *testing.T) {
	h := api.UpdateStatusHandler(writeState(t, stateFile("behind", "v0.4.1", "v0.4.2", "busy")), "v0.4.1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/update-status", nil))
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status %d cache-control %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["state"] != "behind" || body["latest"] != "v0.4.2" || body["available"] != true {
		t.Errorf("body = %v", body)
	}
}
