package insights

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// Store persists and retrieves findings from the session_insights table.
type Store struct{ db *sql.DB }

// NewStore constructs a Store backed by the given *sql.DB.
func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// ReplaceForSession deletes any existing rows for sessionID and inserts
// the supplied findings in a single transaction. Used at session_end and
// for backfill.
func (s *Store) ReplaceForSession(ctx context.Context, rowerID, sessionID string, findings []Finding) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := ReplaceForSessionTx(ctx, tx, rowerID, sessionID, findings); err != nil {
		return err
	}
	return tx.Commit()
}

// ReplaceForSessionTx is the transactional variant — used by
// applySessionEnd which already holds a tx.
func ReplaceForSessionTx(ctx context.Context, tx *sql.Tx, rowerID, sessionID string, findings []Finding) error {
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM session_insights WHERE session_id = ?`, sessionID); err != nil {
		return err
	}
	if len(findings) == 0 {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO session_insights
		  (rower_id, session_id, detector_id, code, severity, category, message_de, evidence_json, computed_at)
		VALUES (?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, f := range findings {
		ev, err := json.Marshal(f.Evidence)
		if err != nil {
			return err
		}
		if _, err := stmt.ExecContext(ctx,
			rowerID, sessionID, f.DetectorID, string(f.Code),
			string(f.Severity), string(f.Category), f.MessageDE, string(ev), now); err != nil {
			return err
		}
	}
	return nil
}

// ListForSession returns findings ordered by severity (ATTENTION first,
// then NOTABLE, then INFO), ties broken by insertion order.
func (s *Store) ListForSession(ctx context.Context, sessionID string) ([]Finding, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT detector_id, code, severity, category, message_de, evidence_json
		FROM session_insights
		WHERE session_id = ?
		ORDER BY CASE severity
		           WHEN 'ATTENTION' THEN 0
		           WHEN 'NOTABLE'   THEN 1
		           ELSE 2 END,
		         id ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var f Finding
		var sev, cat, code, ev string
		if err := rows.Scan(&f.DetectorID, &code, &sev, &cat, &f.MessageDE, &ev); err != nil {
			return nil, err
		}
		f.Code = Code(code)
		f.Severity = Severity(sev)
		f.Category = Category(cat)
		f.Evidence = map[string]float64{}
		if ev != "" {
			if err := json.Unmarshal([]byte(ev), &f.Evidence); err != nil {
				return nil, err
			}
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
