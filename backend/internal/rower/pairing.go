package rower

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"
)

// ErrInvalidToken means the pairing token does not exist, has been
// consumed, or has expired. Callers should map to HTTP 410 Gone.
var ErrInvalidToken = errors.New("invalid pairing token")

// GenerateToken produces a 32-byte (256-bit) cryptographically random
// pairing token, base64url-encoded without padding.
func GenerateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// HashToken returns hex(SHA-256(plain)). Pairing tokens are 256-bit
// random secrets, so a fast hash is sufficient — Argon2id would only
// add CPU cost without security benefit.
func HashToken(plain string) string {
	h := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(h[:])
}

// PairingStore manages pairing_tokens rows.
type PairingStore struct{ DB *sql.DB }

func NewPairingStore(db *sql.DB) *PairingStore { return &PairingStore{DB: db} }

// Mint inserts a fresh token row and returns the plaintext token. The
// caller MUST treat the returned plaintext as the only chance to see
// it; only the hash is persisted.
func (p *PairingStore) Mint(ctx context.Context, rowerID string, ttl time.Duration) (string, error) {
	plain, err := GenerateToken()
	if err != nil {
		return "", err
	}
	expires := time.Now().Add(ttl).UTC()
	if _, err := p.DB.ExecContext(ctx,
		`INSERT INTO pairing_tokens(token_hash, rower_id, expires_at) VALUES(?, ?, ?)`,
		HashToken(plain), rowerID, expires.Format(time.RFC3339Nano)); err != nil {
		return "", err
	}
	return plain, nil
}

// Consume validates plain against pairing_tokens, deletes the row, and
// returns the bound rower_id. Single-use: a successful consume removes
// the row. Returns ErrInvalidToken when missing or expired.
func (p *PairingStore) Consume(ctx context.Context, plain string) (string, error) {
	var rowerID string
	var expiresStr string
	row := p.DB.QueryRowContext(ctx,
		`DELETE FROM pairing_tokens WHERE token_hash = ? RETURNING rower_id, expires_at`,
		HashToken(plain))
	if err := row.Scan(&rowerID, &expiresStr); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrInvalidToken
		}
		return "", err
	}
	exp, err := time.Parse(time.RFC3339Nano, expiresStr)
	if err != nil {
		return "", ErrInvalidToken
	}
	if time.Now().After(exp) {
		return "", ErrInvalidToken
	}
	return rowerID, nil
}

// PurgeExpired removes pairing_tokens rows past their expires_at and
// returns the count removed. Run from the janitor.
func (p *PairingStore) PurgeExpired(ctx context.Context) (int64, error) {
	res, err := p.DB.ExecContext(ctx,
		`DELETE FROM pairing_tokens WHERE expires_at < ?`,
		time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
