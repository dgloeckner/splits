package storage

import (
	"context"
	"database/sql"
	"time"
)

// SoftDeleteSession sets deleted_at on the matching row and removes
// every per-session candidate row. Candidates are derived; they don't
// need to survive the parent's soft state, so recompute queries can
// scope by rower without joining sessions. Noop if id is unknown.
func SoftDeleteSession(ctx context.Context, db *sql.DB, id string, at time.Time) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `UPDATE sessions SET deleted_at = ? WHERE id = ?`,
		at.UTC().Format(time.RFC3339Nano), id); err != nil {
		return err
	}
	if err := DeleteSessionCandidates(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit()
}
