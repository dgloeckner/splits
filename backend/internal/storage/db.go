// Package storage owns the SQLite persistence of sessions and
// strokes. See specs/arch/0001-backend-pipeline.md and ADR-0004.
package storage

import (
	"database/sql"
	"embed"
	"fmt"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

// DB wraps a *sql.DB. Use Open; Close; Handle for test access.
type DB struct {
	db *sql.DB
}

func (d *DB) Handle() *sql.DB { return d.db }
func (d *DB) Close() error    { return d.db.Close() }

// Open opens or creates the SQLite file at path, enables WAL, and
// applies any pending migrations. Safe to call at every process
// start.
func Open(path string) (*DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=foreign_keys(on)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("sql.Open: %w", err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("set WAL: %w", err)
	}
	if err := applyMigrations(db); err != nil {
		db.Close()
		return nil, err
	}
	return &DB{db: db}, nil
}

func applyMigrations(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`); err != nil {
		return fmt.Errorf("migrations bootstrap: %w", err)
	}

	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var version int
		if _, err := fmt.Sscanf(name, "%04d_", &version); err != nil {
			return fmt.Errorf("parse version from %q: %w", name, err)
		}
		var exists int
		if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version=?`, version).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		body, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		if _, err := db.Exec(string(body)); err != nil {
			return fmt.Errorf("apply %s: %w", name, err)
		}
		if _, err := db.Exec(`INSERT OR IGNORE INTO schema_migrations(version) VALUES(?)`, version); err != nil {
			return fmt.Errorf("record %s: %w", name, err)
		}
	}
	return nil
}
