package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/gloeckner-daniel/splits/internal/rower"
)

const cliPairingTTL = 24 * time.Hour

// runCLI handles one-shot subcommands. Returns nil on success, an
// error otherwise. main() prints err to stderr and exits non-zero.
func runCLI(ctx context.Context, db *sql.DB, baseURL string, args []string, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("subcommand required")
	}
	switch args[0] {
	case "invite":
		if len(args) != 2 {
			return errors.New("usage: splits invite <rower-id>")
		}
		return cliInvite(ctx, db, baseURL, args[1], stdout)
	case "revoke":
		if len(args) != 2 {
			return errors.New("usage: splits revoke <rower-id>")
		}
		return cliRevoke(ctx, db, args[1], stdout)
	case "delete-rower":
		if len(args) != 2 {
			return errors.New("usage: splits delete-rower <rower-id>")
		}
		return cliDeleteRower(ctx, db, args[1], stdout)
	case "ls-rowers":
		return cliLsRowers(ctx, db, stdout)
	case "ls-pairings":
		return cliLsPairings(ctx, db, stdout)
	case "ls-tokens":
		return cliLsTokens(ctx, db, stdout)
	}
	return fmt.Errorf("unknown subcommand: %s", args[0])
}

func cliLsRowers(ctx context.Context, db *sql.DB, w io.Writer) error {
	rows, err := db.QueryContext(ctx,
		`SELECT id, name, created_at, deleted_at FROM rowers ORDER BY created_at`)
	if err != nil {
		return err
	}
	defer rows.Close()
	fmt.Fprintln(w, "ID\tNAME\tCREATED\tDELETED")
	for rows.Next() {
		var id, name, created string
		var deleted sql.NullString
		if err := rows.Scan(&id, &name, &created, &deleted); err != nil {
			return err
		}
		d := "-"
		if deleted.Valid {
			d = deleted.String
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", id, name, created, d)
	}
	return rows.Err()
}

func cliLsPairings(ctx context.Context, db *sql.DB, w io.Writer) error {
	rows, err := db.QueryContext(ctx,
		`SELECT device_id, rower_id, paired_at FROM device_rowers ORDER BY paired_at`)
	if err != nil {
		return err
	}
	defer rows.Close()
	fmt.Fprintln(w, "DEVICE\tROWER\tPAIRED")
	for rows.Next() {
		var d, r, p string
		if err := rows.Scan(&d, &r, &p); err != nil {
			return err
		}
		fmt.Fprintf(w, "%s\t%s\t%s\n", d, r, p)
	}
	return rows.Err()
}

func cliLsTokens(ctx context.Context, db *sql.DB, w io.Writer) error {
	rows, err := db.QueryContext(ctx,
		`SELECT token_hash, rower_id, expires_at FROM pairing_tokens ORDER BY expires_at`)
	if err != nil {
		return err
	}
	defer rows.Close()
	fmt.Fprintln(w, "HASH(prefix)\tROWER\tEXPIRES")
	for rows.Next() {
		var h, r, e string
		if err := rows.Scan(&h, &r, &e); err != nil {
			return err
		}
		if len(h) > 12 {
			h = h[:12] + "…"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\n", h, r, e)
	}
	return rows.Err()
}

func cliRevoke(ctx context.Context, db *sql.DB, rowerID string, stdout io.Writer) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res1, err := tx.ExecContext(ctx, `DELETE FROM device_rowers WHERE rower_id = ?`, rowerID)
	if err != nil {
		return err
	}
	res2, err := tx.ExecContext(ctx, `DELETE FROM pairing_tokens WHERE rower_id = ?`, rowerID)
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	p, _ := res1.RowsAffected()
	tk, _ := res2.RowsAffected()
	fmt.Fprintf(stdout, "revoked rower %s: %d device pairing(s), %d outstanding token(s) removed\n", rowerID, p, tk)
	return nil
}

func cliDeleteRower(ctx context.Context, db *sql.DB, rowerID string, stdout io.Writer) error {
	repo := rower.NewRepo(db)
	r, err := repo.Get(ctx, rowerID)
	if err != nil {
		return err
	}
	if r == nil {
		return errors.New("rower not found")
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx,
		`UPDATE rowers SET deleted_at = ? WHERE id = ?`,
		time.Now().UTC().Format(time.RFC3339Nano), rowerID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM device_rowers WHERE rower_id = ?`, rowerID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM pairing_tokens WHERE rower_id = ?`, rowerID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "soft-deleted rower %s (%s); pairings removed\n", r.ID, r.Name)
	return nil
}

func cliInvite(ctx context.Context, db *sql.DB, baseURL, rowerID string, stdout io.Writer) error {
	repo := rower.NewRepo(db)
	r, err := repo.Get(ctx, rowerID)
	if err != nil {
		return err
	}
	if r == nil {
		return errors.New("rower not found")
	}
	store := rower.NewPairingStore(db)
	plain, err := store.Mint(ctx, rowerID, cliPairingTTL)
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout,
		"Pairing URL for %s (%s):\n  %s/pair#t=%s\nValid for 24h, single use.\n",
		r.Name, r.ID, baseURL, plain)
	return nil
}
