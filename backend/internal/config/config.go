package config

import (
	"fmt"
	"strconv"
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
	IdleTimeout time.Duration // consumed by the sessionizer in M2
	DevMode     bool
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
		Addr:        get(env, "HOMEERGO_ADDR", ":8080"),
		SerialPort:  get(env, "HOMEERGO_SERIAL_PORT", ""),
		DBPath:      get(env, "HOMEERGO_DB_PATH", "./homeergo.db"),
		Fixture:     get(env, "HOMEERGO_FIXTURE", ""),
		FixtureRate: get(env, "HOMEERGO_FIXTURE_RATE", "realtime"),
		LogLevel:    get(env, "HOMEERGO_LOG_LEVEL", "info"),
	}

	baudStr := get(env, "HOMEERGO_SERIAL_BAUD", "9600")
	baud, err := strconv.Atoi(baudStr)
	if err != nil {
		return nil, fmt.Errorf("HOMEERGO_SERIAL_BAUD %q: %w", baudStr, err)
	}
	c.SerialBaud = baud

	idleStr := get(env, "HOMEERGO_IDLE_TIMEOUT", "60s")
	idle, err := time.ParseDuration(idleStr)
	if err != nil {
		return nil, fmt.Errorf("HOMEERGO_IDLE_TIMEOUT %q: %w", idleStr, err)
	}
	c.IdleTimeout = idle

	c.DevMode = get(env, "SPLITS_DEV_MODE", "") == "1"

	switch c.FixtureRate {
	case "realtime", "fast":
		// ok
	default:
		return nil, fmt.Errorf("HOMEERGO_FIXTURE_RATE %q: want realtime or fast", c.FixtureRate)
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
