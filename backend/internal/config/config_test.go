package config

import (
	"testing"
	"time"
)

func TestLoad_AllDefaults(t *testing.T) {
	env := func(string) string { return "" }

	got, err := Load(env)
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
	env := map[string]string{
		"HOMEERGO_ADDR":         ":9090",
		"HOMEERGO_SERIAL_PORT":  "/dev/cu.usbserial-AB0JKG07",
		"HOMEERGO_SERIAL_BAUD":  "19200",
		"HOMEERGO_DB_PATH":      "/var/lib/homeergo.db",
		"HOMEERGO_FIXTURE":      "./session-m1.csv",
		"HOMEERGO_FIXTURE_RATE": "fast",
		"HOMEERGO_LOG_LEVEL":    "debug",
		"HOMEERGO_IDLE_TIMEOUT": "30s",
	}
	lookup := func(k string) string { return env[k] }

	got, err := Load(lookup)
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

func TestLoad_InvalidBaud(t *testing.T) {
	env := func(k string) string {
		if k == "HOMEERGO_SERIAL_BAUD" {
			return "not-a-number"
		}
		return ""
	}
	if _, err := Load(env); err == nil {
		t.Fatal("Load() expected error for bad baud, got nil")
	}
}

func TestLoad_InvalidIdleTimeout(t *testing.T) {
	env := func(k string) string {
		if k == "HOMEERGO_IDLE_TIMEOUT" {
			return "not-a-duration"
		}
		return ""
	}
	if _, err := Load(env); err == nil {
		t.Fatal("Load() expected error for bad idle timeout, got nil")
	}
}

func TestLoad_InvalidFixtureRate(t *testing.T) {
	env := func(k string) string {
		if k == "HOMEERGO_FIXTURE_RATE" {
			return "hyperspeed"
		}
		return ""
	}
	if _, err := Load(env); err == nil {
		t.Fatal("Load() expected error for unknown fixture rate, got nil")
	}
}
