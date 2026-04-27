package storage

import (
	"path/filepath"
	"testing"
)

func TestOpenRunsMigrations(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	var v int
	if err := db.Handle().QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&v); err != nil {
		t.Fatalf("query: %v", err)
	}
	if v != 9 {
		t.Errorf("schema_migrations.max(version) = %d, want 9", v)
	}

	var mode string
	if err := db.Handle().QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatalf("pragma: %v", err)
	}
	if mode != "wal" {
		t.Errorf("journal_mode = %q, want wal", mode)
	}
}

func TestOpenIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	db.Close()

	db2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer db2.Close()

	var v int
	if err := db2.Handle().QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&v); err != nil {
		t.Fatalf("query: %v", err)
	}
	if v != 9 {
		t.Errorf("version after reopen = %d", v)
	}
}

func TestMigration0004SchemaExists(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	for _, name := range []string{"workout", "workout_favorite"} {
		var got string
		err := db.Handle().QueryRow(
			`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, name,
		).Scan(&got)
		if err != nil {
			t.Fatalf("expected table %s: %v", name, err)
		}
	}

	var colCount int
	if err := db.Handle().QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='workout_id'`,
	).Scan(&colCount); err != nil || colCount != 1 {
		t.Fatalf("expected sessions.workout_id column, count=%d err=%v", colCount, err)
	}
}
