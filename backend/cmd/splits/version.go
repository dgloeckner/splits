package main

import (
	"fmt"
	"io"
	"runtime/debug"
)

// version and commit are stamped at build time by deploy/build.sh:
//
//	-ldflags "-X main.version=v0.4.1 -X main.commit=abc1234"
//
// The version is the release tag (ADR-0022); the unattended updater
// reads it back from /api/health to decide whether an update came up
// (ADR-0023). An unstamped build reports "dev", which no updater will
// ever mistake for a release.
var (
	version = "dev"
	commit  = ""
)

// buildCommit is the stamped commit, or the VCS revision the Go
// toolchain embedded (a plain `go build` in a checkout), or "unknown".
func buildCommit() string {
	if commit != "" {
		return commit
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			if s.Key == "vcs.revision" && s.Value != "" {
				if len(s.Value) > 7 {
					return s.Value[:7]
				}
				return s.Value
			}
		}
	}
	return "unknown"
}

// isVersionArg reports whether args ask for the version. Checked before
// the config is loaded, so `splits --version` works with any env.
func isVersionArg(args []string) bool {
	if len(args) < 2 {
		return false
	}
	switch args[1] {
	case "--version", "-version", "version":
		return true
	}
	return false
}

func printVersion(w io.Writer) {
	fmt.Fprintf(w, "splits %s (commit %s)\n", version, buildCommit())
}
