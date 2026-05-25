package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// ShapeHasher computes a workout's canonical comparability hash from
// its params_json. Production callers pass workout.ShapeHash; tests can
// pass an in-memory stub. Defining the type here keeps the storage
// package free of an import on internal/workout (which would create a
// cycle: workout_test.go is `package workout` and imports storage).
type ShapeHasher func(params json.RawMessage) (string, error)

// RecomputeShapes detects workout rows with a NULL shape_hash (the
// post-migration state from 0016_invalidate_workout_shape_hash) and
// repopulates them via the supplied hasher. Idempotent: when no NULL
// rows remain, this is a no-op.
//
// Callers should invoke this once after migrations apply at boot,
// BEFORE BootJanitor.Run fires (so when RecomputeStaleRowerStats kicks
// off the PB rebuild, the workout.shape_hash values are already
// correct).
func RecomputeShapes(ctx context.Context, db *sql.DB, hash ShapeHasher) error {
	rows, err := db.QueryContext(ctx,
		`SELECT id, params_json FROM workout WHERE shape_hash IS NULL`)
	if err != nil {
		return fmt.Errorf("recompute shapes: query null: %w", err)
	}
	defer rows.Close()

	type pending struct {
		id     string
		params []byte
	}
	var todo []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.params); err != nil {
			return fmt.Errorf("recompute shapes: scan: %w", err)
		}
		todo = append(todo, p)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("recompute shapes: row iter: %w", err)
	}

	for _, p := range todo {
		h, err := hash(p.params)
		if err != nil {
			// Skip malformed params rather than failing the whole boot.
			continue
		}
		if _, err := db.ExecContext(ctx,
			`UPDATE workout SET shape_hash = ? WHERE id = ?`, h, p.id); err != nil {
			return fmt.Errorf("recompute shapes: update %s: %w", p.id, err)
		}
	}
	return nil
}
