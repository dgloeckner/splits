package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestIsVersionArg(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want bool
	}{
		{[]string{"splits"}, false},
		{[]string{"splits", "--version"}, true},
		{[]string{"splits", "-version"}, true},
		{[]string{"splits", "version"}, true},
		{[]string{"splits", "ls-rowers"}, false},
	} {
		if got := isVersionArg(tc.args); got != tc.want {
			t.Errorf("isVersionArg(%q) = %v, want %v", tc.args, got, tc.want)
		}
	}
}

func TestPrintVersion_Stamped(t *testing.T) {
	defer func(v, c string) { version, commit = v, c }(version, commit)
	version, commit = "v0.4.1", "abc1234"
	var buf bytes.Buffer
	printVersion(&buf)
	if got := buf.String(); got != "splits v0.4.1 (commit abc1234)\n" {
		t.Errorf("printVersion = %q", got)
	}
}

func TestPrintVersion_UnstampedIsDev(t *testing.T) {
	defer func(v, c string) { version, commit = v, c }(version, commit)
	commit = ""
	var buf bytes.Buffer
	printVersion(&buf)
	if !strings.HasPrefix(buf.String(), "splits dev (commit ") {
		t.Errorf("printVersion = %q, want the dev prefix", buf.String())
	}
	if buildCommit() == "" {
		t.Error("buildCommit is empty; want a revision or \"unknown\"")
	}
}
