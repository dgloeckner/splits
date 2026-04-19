package config

import (
	"fmt"
	"strconv"
	"time"
)

// Config is the fully-resolved runtime configuration. See
// specs/arch/0001-backend-pipeline.md for the list of env vars.
type Config struct {
	Addr         string
	SerialPort   string
	SerialBaud   int
	DBPath       string
	Fixture      string
	FixtureRate  string
	LogLevel     string
	IdleTimeout  time.Duration
}

// Load resolves a Config from environment variables via the supplied
// lookup function. Passing os.Getenv in main and a map-backed closure
// in tests keeps Load pure and deterministic.
func Load(env func(string) string) (*Config, error) {
	c := &Config{
		Addr:        getenv(env, "HOMEERGO_ADDR", ":8080"),
		SerialPort:  getenv(env, "HOMEERGO_SERIAL_PORT", ""),
		DBPath:      getenv(env, "HOMEERGO_DB_PATH", "./homeergo.db"),
		Fixture:     getenv(env, "HOMEERGO_FIXTURE", ""),
		FixtureRate: getenv(env, "HOMEERGO_FIXTURE_RATE", "realtime"),
		LogLevel:    getenv(env, "HOMEERGO_LOG_LEVEL", "info"),
	}

	baudStr := getenv(env, "HOMEERGO_SERIAL_BAUD", "9600")
	baud, err := strconv.Atoi(baudStr)
	if err != nil {
		return nil, fmt.Errorf("HOMEERGO_SERIAL_BAUD %q: %w", baudStr, err)
	}
	c.SerialBaud = baud

	idleStr := getenv(env, "HOMEERGO_IDLE_TIMEOUT", "60s")
	idle, err := time.ParseDuration(idleStr)
	if err != nil {
		return nil, fmt.Errorf("HOMEERGO_IDLE_TIMEOUT %q: %w", idleStr, err)
	}
	c.IdleTimeout = idle

	switch c.FixtureRate {
	case "realtime", "fast":
		// ok
	default:
		return nil, fmt.Errorf("HOMEERGO_FIXTURE_RATE %q: want realtime or fast", c.FixtureRate)
	}

	return c, nil
}

func getenv(env func(string) string, key, fallback string) string {
	if v := env(key); v != "" {
		return v
	}
	return fallback
}
