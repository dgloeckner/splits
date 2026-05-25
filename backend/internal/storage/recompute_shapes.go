package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
)

// RecomputeShapes detects workout rows with a NULL shape_hash (the
// post-migration state from 0016_invalidate_workout_shape_hash) and
// repopulates them using the same canonical-params SHA-256 algorithm as
// workout.ShapeHash. Idempotent: when no NULL rows remain, this is a
// no-op.
//
// Callers should invoke this once after migrations apply at boot, BEFORE
// BootJanitor.Run fires (so when RecomputeStaleRowerStats kicks off the
// PB rebuild, the workout.shape_hash values are already correct).
//
// Note: the hash algorithm is inlined here (rather than imported from
// internal/workout) to avoid a test-binary import cycle: workout_test.go
// (package workout) imports storage, so storage must not import workout.
func RecomputeShapes(ctx context.Context, db *sql.DB) error {
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
		h, err := shapeHash(p.params)
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

// shapeHash is a local copy of workout.ShapeHash. Both must produce
// identical output — the unit test in recompute_shapes_test.go verifies
// this by comparing against workout.ShapeHash directly.
func shapeHash(params json.RawMessage) (string, error) {
	canon, err := canonicalJSONForHash(params)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canon)
	return hex.EncodeToString(sum[:]), nil
}

func canonicalJSONForHash(in json.RawMessage) (json.RawMessage, error) {
	if len(in) == 0 {
		return json.RawMessage("{}"), nil
	}
	var asMap map[string]json.RawMessage
	if err := json.Unmarshal(in, &asMap); err != nil {
		return in, nil
	}
	keys := make([]string, 0, len(asMap))
	for k := range asMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	buf := []byte{'{'}
	for i, k := range keys {
		if i > 0 {
			buf = append(buf, ',')
		}
		kb, err := json.Marshal(k)
		if err != nil {
			return nil, err
		}
		buf = append(buf, kb...)
		buf = append(buf, ':')
		v, err := canonicalJSONForHash(asMap[k])
		if err != nil {
			return nil, err
		}
		buf = append(buf, v...)
	}
	buf = append(buf, '}')
	return buf, nil
}
