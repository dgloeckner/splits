package config

import (
	"testing"
	"time"
)

// mapLookup builds a Lookup whose "ok" result reflects presence in m.
func mapLookup(m map[string]string) Lookup {
	return func(k string) (string, bool) {
		v, ok := m[k]
		return v, ok
	}
}

func TestLoad_AllDefaults(t *testing.T) {
	got, err := Load(mapLookup(nil))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	// DBPath default is ./splits.db, but Load auto-falls-back to
	// ./homeergo.db if only the legacy file exists in CWD. Accept either.
	wantDB := got.DBPath
	if wantDB != "./splits.db" && wantDB != "./homeergo.db" {
		t.Errorf("DBPath = %q, want ./splits.db or ./homeergo.db", wantDB)
	}
	want := &Config{
		Addr:         ":8080",
		SerialPort:   "",
		SerialBaud:   9600,
		DBPath:       wantDB,
		Fixture:      "",
		FixtureRate:  "realtime",
		LogLevel:     "info",
		IdleTimeout:  60 * time.Second,
		PauseTimeout: 10 * time.Second,
		ResumeWindow: 15 * time.Minute,
	}
	if *got != *want {
		t.Errorf("Load() = %+v, want %+v", got, want)
	}
}

func TestLoad_AcceptsSPLITSEnvVars(t *testing.T) {
	env := func(k string) (string, bool) {
		switch k {
		case "SPLITS_ADDR":
			return ":9999", true
		case "SPLITS_DB_PATH":
			return "/tmp/splits.db", true
		case "SPLITS_FIXTURE":
			return "fixt.bin", true
		}
		return "", false
	}
	cfg, err := Load(env)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != ":9999" || cfg.DBPath != "/tmp/splits.db" || cfg.Fixture != "fixt.bin" {
		t.Fatalf("got %+v", cfg)
	}
}

func TestLoad_LegacyHOMEERGOVarsStillWork(t *testing.T) {
	env := func(k string) (string, bool) {
		if k == "HOMEERGO_ADDR" {
			return ":7777", true
		}
		if k == "HOMEERGO_DB_PATH" {
			return "/tmp/legacy.db", true
		}
		return "", false
	}
	cfg, err := Load(env)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != ":7777" {
		t.Fatalf("want :7777 got %s", cfg.Addr)
	}
	if cfg.DBPath != "/tmp/legacy.db" {
		t.Fatalf("want legacy db got %s", cfg.DBPath)
	}
}

func TestLoad_PrimaryWinsOverLegacy(t *testing.T) {
	env := func(k string) (string, bool) {
		if k == "SPLITS_ADDR" {
			return ":9999", true
		}
		if k == "HOMEERGO_ADDR" {
			return ":1111", true
		}
		return "", false
	}
	cfg, err := Load(env)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != ":9999" {
		t.Fatalf("primary should win, got %s", cfg.Addr)
	}
}

func TestLoad_EnvOverrides(t *testing.T) {
	got, err := Load(mapLookup(map[string]string{
		"HOMEERGO_ADDR":         ":9090",
		"HOMEERGO_SERIAL_PORT":  "/dev/cu.usbserial-AB0JKG07",
		"HOMEERGO_SERIAL_BAUD":  "19200",
		"HOMEERGO_DB_PATH":      "/var/lib/homeergo.db",
		"HOMEERGO_FIXTURE":      "./session-m1.csv",
		"HOMEERGO_FIXTURE_RATE": "fast",
		"HOMEERGO_LOG_LEVEL":    "debug",
		"HOMEERGO_IDLE_TIMEOUT": "30s",
	}))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	want := &Config{
		Addr:         ":9090",
		SerialPort:   "/dev/cu.usbserial-AB0JKG07",
		SerialBaud:   19200,
		DBPath:       "/var/lib/homeergo.db",
		Fixture:      "./session-m1.csv",
		FixtureRate:  "fast",
		LogLevel:     "debug",
		IdleTimeout:  30 * time.Second,
		PauseTimeout: 10 * time.Second,
		ResumeWindow: 15 * time.Minute,
	}
	if *got != *want {
		t.Errorf("Load() = %+v, want %+v", got, want)
	}
}

func TestLoad_EmptyStringIsExplicit(t *testing.T) {
	// An explicit HOMEERGO_ADDR="" must not silently fall back to :8080 —
	// it is a distinct user choice (and, being unusable, should surface
	// itself elsewhere; Load's job is faithful reporting, not validation).
	got, err := Load(mapLookup(map[string]string{"HOMEERGO_ADDR": ""}))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if got.Addr != "" {
		t.Errorf("Addr = %q, want empty string (explicit override)", got.Addr)
	}
}

func TestLoad_InvalidBaud(t *testing.T) {
	if _, err := Load(mapLookup(map[string]string{"HOMEERGO_SERIAL_BAUD": "not-a-number"})); err == nil {
		t.Fatal("Load() expected error for bad baud, got nil")
	}
}

func TestLoad_InvalidIdleTimeout(t *testing.T) {
	if _, err := Load(mapLookup(map[string]string{"HOMEERGO_IDLE_TIMEOUT": "not-a-duration"})); err == nil {
		t.Fatal("Load() expected error for bad idle timeout, got nil")
	}
}

func TestLoad_DevModeFromSPLITS(t *testing.T) {
	cfg, err := Load(func(k string) (string, bool) {
		if k == "SPLITS_DEV_MODE" {
			return "1", true
		}
		return "", false
	})
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.DevMode {
		t.Fatal("want DevMode=true")
	}
}

func TestLoad_PublicURL(t *testing.T) {
	cfg, err := Load(func(k string) (string, bool) {
		if k == "SPLITS_PUBLIC_URL" {
			return "https://splits.example.de", true
		}
		return "", false
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicURL != "https://splits.example.de" {
		t.Fatalf("got %q", cfg.PublicURL)
	}
}

func TestLoad_PublicURL_LegacyVar(t *testing.T) {
	cfg, err := Load(func(k string) (string, bool) {
		if k == "HOMEERGO_PUBLIC_URL" {
			return "https://legacy.example.de", true
		}
		return "", false
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicURL != "https://legacy.example.de" {
		t.Fatalf("got %q", cfg.PublicURL)
	}
}

func TestLoad_FixturePaused(t *testing.T) {
	for _, tc := range []struct {
		val  string
		want bool
	}{
		{"1", true},
		{"true", true},
		{"TRUE", true},
		{"True", true},
		{"0", false},
		{"false", false},
		{"", false},
	} {
		cfg, err := Load(mapLookup(map[string]string{"SPLITS_FIXTURE_PAUSED": tc.val}))
		if err != nil {
			t.Fatalf("val=%q: %v", tc.val, err)
		}
		if cfg.FixturePaused != tc.want {
			t.Errorf("val=%q: FixturePaused = %v, want %v", tc.val, cfg.FixturePaused, tc.want)
		}
	}
}

func TestLoad_FixturePausedDefaultFalse(t *testing.T) {
	cfg, err := Load(mapLookup(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.FixturePaused {
		t.Fatal("FixturePaused default should be false")
	}
}

func TestLoad_InvalidFixtureRate(t *testing.T) {
	if _, err := Load(mapLookup(map[string]string{"HOMEERGO_FIXTURE_RATE": "hyperspeed"})); err == nil {
		t.Fatal("Load() expected error for unknown fixture rate, got nil")
	}
}

func TestLoad_ResumeWindow_Override(t *testing.T) {
	cfg, err := Load(mapLookup(map[string]string{"SPLITS_RESUME_WINDOW": "20m"}))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.ResumeWindow != 20*time.Minute {
		t.Errorf("ResumeWindow = %v, want 20m", cfg.ResumeWindow)
	}
}

func TestLoad_ResumeWindow_Default(t *testing.T) {
	cfg, err := Load(mapLookup(nil))
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.ResumeWindow != 15*time.Minute {
		t.Errorf("ResumeWindow default = %v, want 15m", cfg.ResumeWindow)
	}
}

func TestLoad_InvalidResumeWindow(t *testing.T) {
	if _, err := Load(mapLookup(map[string]string{"SPLITS_RESUME_WINDOW": "not-a-duration"})); err == nil {
		t.Fatal("Load() expected error for bad resume window, got nil")
	}
}
