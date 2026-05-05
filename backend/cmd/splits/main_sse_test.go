package main

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func startServer(t *testing.T, fixture string) string {
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
	// Realtime pacing: gives the test time to issue /session/start
	// after the server is healthy but before all fixture frames have
	// been delivered.
	os.Setenv("HOMEERGO_FIXTURE_RATE", "realtime")
	os.Setenv("HOMEERGO_IDLE_TIMEOUT", "60s")
	os.Setenv("SPLITS_DEV_MODE", "1")

	done := make(chan error, 1)
	go func() { done <- run() }()
	t.Cleanup(func() {
		// run() blocks on SIGINT/SIGTERM; send one so cleanup doesn't hang.
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
	return "http://" + addr
}

func waitForServer(t *testing.T, url string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if r, err := http.Get(url); err == nil {
			r.Body.Close()
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("server at %s never came up", url)
}

func TestEndToEndShortSession(t *testing.T) {
	base := startServer(t, "../../../specs/int/fixtures/ipm/session-short.csv")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// RequireRower middleware (ADR-0005) gates /session/start and
	// /stream — bootstrap a rower first via the empty-DB exception.
	client := newClientWithJar(t)
	bootstrapRower(t, client, base)

	// Sessions no longer auto-open from incoming frames; the user
	// must explicitly start one (FEAT-0009 / new-workout flow).
	startReq, _ := http.NewRequestWithContext(ctx, "POST", base+"/api/v1/session/start", strings.NewReader("{}"))
	startResp, err := client.Do(startReq)
	if err != nil {
		t.Fatal(err)
	}
	startResp.Body.Close()

	req, _ := http.NewRequestWithContext(ctx, "GET", base+"/api/v1/stream", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	rd := bufio.NewReader(resp.Body)
	var kinds []string
	seenStroke := 0
	for i := 0; i < 30 && ctx.Err() == nil; i++ {
		block, err := readBlock(rd)
		if err != nil {
			break
		}
		for _, line := range strings.Split(block, "\n") {
			if strings.HasPrefix(line, "event: ") {
				k := strings.TrimPrefix(line, "event: ")
				kinds = append(kinds, k)
				if k == "stroke" {
					seenStroke++
				}
			}
		}
		if seenStroke >= 2 {
			break
		}
	}
	if len(kinds) == 0 || kinds[0] != "session_start" {
		t.Errorf("first event = %q, want session_start (all = %v)", firstOrEmpty(kinds), kinds)
	}
	if seenStroke < 2 {
		t.Errorf("saw %d strokes, wanted >= 2", seenStroke)
	}
}

func readBlock(rd *bufio.Reader) (string, error) {
	var b strings.Builder
	for {
		line, err := rd.ReadString('\n')
		if err != nil {
			return "", err
		}
		if line == "\n" {
			return b.String(), nil
		}
		b.WriteString(line)
	}
}

func firstOrEmpty(xs []string) string {
	if len(xs) == 0 {
		return ""
	}
	return xs[0]
}
