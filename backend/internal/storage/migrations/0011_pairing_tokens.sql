-- FEAT-0002: per-rower pairing tokens. Each row is a single-use,
-- 24h-expiring credential allowing a fresh device to claim a rower.
-- Storage is hex(SHA-256(token)) so a leaked DB never yields plaintext.
CREATE TABLE IF NOT EXISTS pairing_tokens (
  token_hash TEXT PRIMARY KEY,
  rower_id   TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  FOREIGN KEY (rower_id) REFERENCES rowers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_rower ON pairing_tokens(rower_id);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_expires ON pairing_tokens(expires_at);
