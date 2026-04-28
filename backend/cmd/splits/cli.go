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
	}
	return fmt.Errorf("unknown subcommand: %s", args[0])
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
