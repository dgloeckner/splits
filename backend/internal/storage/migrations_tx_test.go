package storage

import "testing"

// A failing statement mid-migration must roll back the whole file and
// leave the version unrecorded — required for multi-statement
// migrations (0018+). DDL is transactional in SQLite, so the CREATE
// TABLE must also disappear.
func TestApplyMigrationRollsBackOnFailure(t *testing.T) {
	db := testDB(t)
	body := `
CREATE TABLE tx_probe(id INTEGER PRIMARY KEY);
INSERT INTO tx_probe(id) VALUES(1);
INSERT INTO no_such_table(id) VALUES(1);`
	if err := applyMigration(db.Handle(), "9999_tx_probe.sql", 9999, body); err == nil {
		t.Fatal("expected error from failing migration body")
	}
	var n int
	if err := db.Handle().QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tx_probe'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("tx_probe table survived rollback")
	}
	if err := db.Handle().QueryRow(
		`SELECT COUNT(*) FROM schema_migrations WHERE version=9999`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("version 9999 recorded despite failure")
	}
}
