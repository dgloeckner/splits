package storage

import (
	"context"
	"database/sql"
	"time"
)

// SoftDeleteSession sets deleted_at on the matching row. Noop if id is unknown.
func SoftDeleteSession(ctx context.Context, db *sql.DB, id string, at time.Time) error {
	_, err := db.ExecContext(ctx, `UPDATE sessions SET deleted_at = ? WHERE id = ?`,
		at.UTC().Format(time.RFC3339Nano), id)
	return err
}
