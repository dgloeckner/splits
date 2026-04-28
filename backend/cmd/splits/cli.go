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
	}
	return fmt.Errorf("unknown subcommand: %s", args[0])
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
