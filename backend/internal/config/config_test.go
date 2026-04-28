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
	want := &Config{
		Addr:        ":8080",
		SerialPort:  "",
		SerialBaud:  9600,
		DBPath:      "./homeergo.db",
		Fixture:     "",
		FixtureRate: "realtime",
		LogLevel:    "info",
		IdleTimeout: 60 * time.Second,
	}
	if *got != *want {
		t.Errorf("Load() = %+v, want %+v", got, want)
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
		Addr:        ":9090",
		SerialPort:  "/dev/cu.usbserial-AB0JKG07",
		SerialBaud:  19200,
		DBPath:      "/var/lib/homeergo.db",
		Fixture:     "./session-m1.csv",
		FixtureRate: "fast",
		LogLevel:    "debug",
		IdleTimeout: 30 * time.Second,
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

func TestLoad_InvalidFixtureRate(t *testing.T) {
	if _, err := Load(mapLookup(map[string]string{"HOMEERGO_FIXTURE_RATE": "hyperspeed"})); err == nil {
		t.Fatal("Load() expected error for unknown fixture rate, got nil")
	}
}
