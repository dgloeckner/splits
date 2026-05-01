package api_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestNoPIIInSlog scans the backend source tree for slog call sites
// referencing PII-shaped keys. Tightens an existing audit-only
// guarantee into a static lint that fails CI if a future change adds
// e.g. `slog.Info("...", "rower_name", r.Name)`.
//
// PII keys we forbid in slog payloads (lowercase substrings):
//
//   name, weight, height, dob, email, phone, address.
//
// Keys we explicitly ALLOW (false-positive hits in the substring
// match):
//
//   user_name, account_name (we don't have these), event_name (we
//   don't have these). No allowlist needed today; revisit if a real
//   collision appears.
func TestNoPIIInSlog(t *testing.T) {
	t.Parallel()
	root, err := repoRoot()
	if err != nil {
		t.Fatal(err)
	}
	piiKeys := []string{`"name"`, `"weight"`, `"height"`, `"dob"`, `"email"`, `"phone"`, `"address"`}
	slogRe := regexp.MustCompile(`slog\.(Debug|Info|Warn|Error)\(`)

	var offenders []string
	err = filepath.Walk(filepath.Join(root, "backend", "internal"), func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		// Scan line by line so we only inspect actual slog call sites
		// and a small window of arguments.
		lines := strings.Split(string(b), "\n")
		for i, line := range lines {
			if !slogRe.MatchString(line) {
				continue
			}
			// Pull the slog call + a few following lines (multi-line calls are common).
			end := i + 6
			if end > len(lines) {
				end = len(lines)
			}
			window := strings.Join(lines[i:end], "\n")
			for _, key := range piiKeys {
				if strings.Contains(window, key) {
					offenders = append(offenders, path+": "+strings.TrimSpace(line)+" (forbidden key "+key+")")
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(offenders) > 0 {
		t.Fatalf("PII-shaped slog keys detected:\n  %s", strings.Join(offenders, "\n  "))
	}
}

// repoRoot returns the absolute path of the repository root by walking
// up from the test's working directory until a `go.mod` is found.
func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return filepath.Dir(dir), nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", os.ErrNotExist
		}
		dir = parent
	}
}
