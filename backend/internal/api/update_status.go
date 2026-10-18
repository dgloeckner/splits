package api

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"regexp"
)

// UpdateStatus is GET /api/v1/update-status: the unattended updater's
// last verdict (ADR-0023 §4), so a stuck Pi is visible from the phone.
//
// The updater (deploy/splits-update.sh) writes update-state.json and
// names the State itself — it is the one place that compares two tags.
// This handler only passes the file on, after checking it: a state
// outside the five, or a tag that is not a release tag, reads as
// "unknown" rather than as whatever it claims.
type UpdateStatus struct {
	// Available is false when there is no state file yet (a fresh or
	// hand-managed install, or a dev machine).
	Available bool   `json:"available"`
	State     string `json:"state"`
	// Running is the version of the backend answering this request.
	Running   string   `json:"running"`
	Installed string   `json:"installed,omitempty"`
	Previous  string   `json:"previous,omitempty"`
	Latest    string   `json:"latest,omitempty"`
	CheckedAt string   `json:"checked_at,omitempty"`
	Result    string   `json:"result,omitempty"`
	Message   string   `json:"message,omitempty"`
	Blocked   []string `json:"blocked"`
}

// The five states of ADR-0023 §4.
const (
	UpdateStateCurrent = "current"
	UpdateStateBehind  = "behind"
	UpdateStateStuck   = "stuck"
	UpdateStateUnknown = "unknown"
	UpdateStateOff     = "off"
)

// Same shape release.yml and the updater accept: vX.Y.Z[-suffix].
var releaseTagRe = regexp.MustCompile(`^v[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}(-[0-9A-Za-z.]{1,32})?$`)

// Updater results are short kebab-case words (updated, rolled-back, …).
var updateResultRe = regexp.MustCompile(`^[a-z][a-z-]{0,31}$`)

// ReadUpdateStatus reads and validates the updater's state file.
func ReadUpdateStatus(path, running string) UpdateStatus {
	out := UpdateStatus{State: UpdateStateUnknown, Running: running, Blocked: []string{}}
	b, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			slog.Warn("update_status.read", "path", path, "err", err)
		}
		return out
	}
	var raw struct {
		State     string   `json:"state"`
		Installed string   `json:"installed"`
		Previous  string   `json:"previous"`
		Latest    string   `json:"latest"`
		CheckedAt string   `json:"checked_at"`
		Result    string   `json:"result"`
		Message   string   `json:"message"`
		Blocked   []string `json:"blocked"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		slog.Warn("update_status.parse", "path", path, "err", err)
		return out
	}
	out.Available = true
	tag := func(s string) string {
		if releaseTagRe.MatchString(s) {
			return s
		}
		return ""
	}
	out.Installed, out.Previous, out.Latest = tag(raw.Installed), tag(raw.Previous), tag(raw.Latest)
	out.CheckedAt = raw.CheckedAt
	if updateResultRe.MatchString(raw.Result) {
		out.Result = raw.Result
	}
	if len(raw.Message) <= 500 {
		out.Message = raw.Message
	}
	for _, t := range raw.Blocked {
		if releaseTagRe.MatchString(t) {
			out.Blocked = append(out.Blocked, t)
		}
	}
	switch raw.State {
	case UpdateStateCurrent, UpdateStateBehind, UpdateStateStuck, UpdateStateOff:
		out.State = raw.State
	}
	// A state that needs a tag it does not carry is not believed.
	if out.Installed == "" && out.State != UpdateStateOff {
		out.State = UpdateStateUnknown
	}
	if (out.State == UpdateStateBehind || out.State == UpdateStateStuck) && out.Latest == "" {
		out.State = UpdateStateUnknown
	}
	return out
}

// UpdateStatusHandler serves GET /api/v1/update-status from the state
// file at path. running is this binary's version.
func UpdateStatusHandler(path, running string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(ReadUpdateStatus(path, running))
	})
}
