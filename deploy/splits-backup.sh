#!/usr/bin/env bash
# Daily SQLite backup. Uses sqlite3's .backup so the DB stays
# read-consistent even if the server is writing concurrently. Keeps
# the last 14 dailies + first-of-month archives indefinitely (small,
# WAL-checkpointed copies).
set -euo pipefail

DB="${SPLITS_DB_PATH:-/var/lib/splits/splits.db}"
DEST="${SPLITS_BACKUP_DIR:-/var/lib/splits/backups}"
DAILY_KEEP="${SPLITS_BACKUP_DAILY_KEEP:-14}"

mkdir -p "$DEST"
ts="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
day="$(date -u +%Y-%m-%d)"
out="$DEST/splits-$ts.db"

# .backup is the recommended online-backup primitive: copies pages
# under a checkpoint, safe with a concurrently-writing server.
sqlite3 "$DB" ".backup '$out'"
gzip -9 "$out"

# Hardlink first-of-month copies into archive/ so retention only prunes
# rotating dailies.
if [ "$(date -u +%d)" = "01" ]; then
  mkdir -p "$DEST/archive"
  ln "$out.gz" "$DEST/archive/splits-$day.db.gz" 2>/dev/null || true
fi

# Prune dailies older than DAILY_KEEP days.
find "$DEST" -maxdepth 1 -type f -name 'splits-*.db.gz' \
  -mtime +"$DAILY_KEEP" -delete

echo "splits-backup ok → $out.gz"
