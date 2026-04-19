package config

import "time"

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

// Load is defined in Task 3.
func Load(env func(string) string) (*Config, error) {
	return nil, nil
}
