package config

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the fully-resolved runtime configuration. See
// specs/arch/0001-backend-pipeline.md for the list of env vars.
type Config struct {
	Addr        string
	SerialPort  string
	SerialBaud  int
	DBPath      string        // consumed by the persister in M2
	Fixture     string
	FixtureRate string
	LogLevel    string
	IdleTimeout  time.Duration // consumed by the sessionizer in M2
	PauseTimeout time.Duration // how long distance must be frozen before Paused sub-state; consumed by sessionizer
	ResumeWindow time.Duration // max pause before a session is abandoned; consumed by the sessionizer
	// FixtureDelay defers the FixtureProducer's first frame by this
	// duration. Zero means "start immediately" (production / dev). E2E
	// tests set it to a few seconds so the user-flow under test (rower
	// onboarding + click "Start") finishes BEFORE the fixture begins
	// streaming, otherwise frames are dropped at the sessionizer
	// because no session is open yet. Env: SPLITS_FIXTURE_DELAY.
	FixtureDelay time.Duration
	// FixturePaused, when true, starts the FixtureProducer in a paused
	// state — no frames are emitted until POST /test/fixture/resume is
	// called. Used by race-mode E2E to align stroke emission with a
	// phase boundary (e.g. produce a stroke during ATTENTION). Env:
	// SPLITS_FIXTURE_PAUSED ("1" or "true").
	FixturePaused bool
	DevMode       bool
	// PublicURL is the externally-reachable base URL of this instance
	// (e.g. https://splits.example.de). Used to build absolute pairing
	// URLs encoded into QR codes. Empty means "derive from request Host".
	// Primary env: SPLITS_PUBLIC_URL; legacy: HOMEERGO_PUBLIC_URL.
	PublicURL string
	// UpdateStatePath is the unattended updater's update-state.json,
	// served by GET /api/v1/update-status (ADR-0023 §4). Env:
	// SPLITS_UPDATE_STATE; default /opt/splits/update-state.json.
	UpdateStatePath string
}

// Lookup mirrors os.LookupEnv: it reports whether the key was set and,
// if so, its value. Distinguishing unset from empty lets an explicit
// empty override a default instead of silently falling through.
type Lookup func(key string) (value string, ok bool)

// Load resolves a Config from environment variables via the supplied
// lookup function. Pass os.LookupEnv in main and a map-backed closure
// in tests to keep Load pure and deterministic.
func Load(env Lookup) (*Config, error) {
	c := &Config{
		Addr:        get2(env, "SPLITS_ADDR", "HOMEERGO_ADDR", ":8080"),
		SerialPort:  get2(env, "SPLITS_SERIAL_PORT", "HOMEERGO_SERIAL_PORT", ""),
		DBPath:      get2(env, "SPLITS_DB_PATH", "HOMEERGO_DB_PATH", "./splits.db"),
		Fixture:     get2(env, "SPLITS_FIXTURE", "HOMEERGO_FIXTURE", ""),
		FixtureRate: get2(env, "SPLITS_FIXTURE_RATE", "HOMEERGO_FIXTURE_RATE", "realtime"),
		LogLevel:    get2(env, "SPLITS_LOG_LEVEL", "HOMEERGO_LOG_LEVEL", "info"),
	}

	baudStr := get2(env, "SPLITS_SERIAL_BAUD", "HOMEERGO_SERIAL_BAUD", "9600")
	baud, err := strconv.Atoi(baudStr)
	if err != nil {
		return nil, fmt.Errorf("SPLITS_SERIAL_BAUD %q: %w", baudStr, err)
	}
	c.SerialBaud = baud

	idleStr := get2(env, "SPLITS_IDLE_TIMEOUT", "HOMEERGO_IDLE_TIMEOUT", "60s")
	idle, err := time.ParseDuration(idleStr)
	if err != nil {
		return nil, fmt.Errorf("SPLITS_IDLE_TIMEOUT %q: %w", idleStr, err)
	}
	c.IdleTimeout = idle

	pauseStr := get(env, "SPLITS_PAUSE_TIMEOUT", "10s")
	pause, err := time.ParseDuration(pauseStr)
	if err != nil {
		return nil, fmt.Errorf("SPLITS_PAUSE_TIMEOUT %q: %w", pauseStr, err)
	}
	c.PauseTimeout = pause

	resumeStr := get(env, "SPLITS_RESUME_WINDOW", "15m")
	resume, err := time.ParseDuration(resumeStr)
	if err != nil {
		return nil, fmt.Errorf("SPLITS_RESUME_WINDOW %q: %w", resumeStr, err)
	}
	c.ResumeWindow = resume

	if v, ok := env("SPLITS_FIXTURE_DELAY"); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("SPLITS_FIXTURE_DELAY %q: %w", v, err)
		}
		c.FixtureDelay = d
	}
	c.DevMode = get(env, "SPLITS_DEV_MODE", "") == "1"
	c.FixturePaused = parseBool(get(env, "SPLITS_FIXTURE_PAUSED", ""))
	c.PublicURL = get2(env, "SPLITS_PUBLIC_URL", "HOMEERGO_PUBLIC_URL", "")
	c.UpdateStatePath = get(env, "SPLITS_UPDATE_STATE", "/opt/splits/update-state.json")

	switch c.FixtureRate {
	case "realtime", "fast":
		// ok
	default:
		return nil, fmt.Errorf("SPLITS_FIXTURE_RATE %q: want realtime or fast", c.FixtureRate)
	}

	// One-release migration window: if the user did not override DBPath
	// and only the legacy ./homeergo.db exists, keep using it and warn.
	if c.DBPath == "./splits.db" {
		if _, err := os.Stat(c.DBPath); errors.Is(err, fs.ErrNotExist) {
			if _, err := os.Stat("./homeergo.db"); err == nil {
				c.DBPath = "./homeergo.db"
				slog.Warn("config.legacy_db_path", "path", "./homeergo.db", "advice", "rename to splits.db at next downtime")
			}
		}
	}

	return c, nil
}

// get returns the looked-up value if the key is set (even to ""), else
// the fallback. Setting a var to the empty string is an explicit choice
// distinct from leaving it unset.
func get(env Lookup, key, fallback string) string {
	if v, ok := env(key); ok {
		return v
	}
	return fallback
}

// parseBool recognises "1" / "true" (case-insensitive) as true. All
// other values — including "0", "false", or "" — yield false. Kept
// local to config to avoid pulling in strconv's stricter semantics
// (e.g. strconv.ParseBool would reject "yes").
func parseBool(s string) bool {
	switch strings.ToLower(s) {
	case "1", "true":
		return true
	}
	return false
}

// get2 prefers the primary key; falls back to a legacy key for one
// release window during the homeergo→splits brand migration.
func get2(env Lookup, primary, legacy, fallback string) string {
	if v, ok := env(primary); ok {
		return v
	}
	if v, ok := env(legacy); ok {
		return v
	}
	return fallback
}
