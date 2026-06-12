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
	// Pi Zero ARM6 latency tuning:
	//   synchronous=NORMAL — fsync at checkpoint only (one fsync per
	//     ~1000-page WAL chunk instead of one per commit). Crash-safe
	//     under WAL; only loses last txn on power loss.
	//   temp_store=MEMORY — temp tables in RAM (no SD-card writes).
	//   mmap_size=64 MB — read-only mmap for page cache.
	//   cache_size=-8000 — 8 MB page cache.
	//   wal_autocheckpoint=1000 — explicit (matches default).
	dsn := fmt.Sprintf(
		"file:%s?_pragma=busy_timeout(5000)"+
			"&_pragma=foreign_keys(on)"+
			"&_pragma=synchronous(NORMAL)"+
			"&_pragma=temp_store(MEMORY)"+
			"&_pragma=mmap_size(67108864)"+
			"&_pragma=cache_size(-8000)"+
			"&_pragma=wal_autocheckpoint(1000)",
		path,
	)
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
		if err := applyMigration(db, name, version, string(body)); err != nil {
			return err
		}
	}
	return nil
}

// applyMigration runs one migration body plus its schema_migrations
// record inside a single transaction, so multi-statement migrations
// (0018+) are atomic: a mid-file failure leaves no partial schema and
// no recorded version.
func applyMigration(db *sql.DB, name string, version int, body string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(body); err != nil {
		return fmt.Errorf("apply %s: %w", name, err)
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO schema_migrations(version) VALUES(?)`, version); err != nil {
		return fmt.Errorf("record %s: %w", name, err)
	}
	return tx.Commit()
}
