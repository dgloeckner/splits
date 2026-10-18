#!/usr/bin/env bash
#
# splits-update.sh — install the latest splits release, atomically, and
# roll it back if it does not come up healthy.
#
# The decision is ADR-0023 (pattern: clubbar ADR-0054). One rule: a Pi
# runs the repository's latest non-pre-release GitHub Release. Publishing
# a Release is the single act that moves every Pi; there is nothing to
# bless or pick on this machine.
#
# Everything below is either that comparison or a refusal to act on it.
# Every refusal exits 0 and means "no update, try again tomorrow": a Pi
# that skips a night has lost nothing, while a Pi that updates when it
# should not have is an Ergo nobody can row on.
#
# Usage:
#   splits-update.sh               # the nightly run (what the timer calls)
#   splits-update.sh --check       # decide, report, change nothing
#   splits-update.sh --status      # installed, previous, blocked, last result
#   splits-update.sh --clear-block # forget failed tags, so they may retry
#
# Configuration, read from /etc/splits/splits.env (the environment wins):
#   SPLITS_UPDATE_ENABLED         1 (default) or 0 to opt this Pi out
#   SPLITS_UPDATE_PIN             hold at exactly this tag
#   SPLITS_UPDATE_REPO            where Releases come from (dgloeckner/splits)
#   SPLITS_UPDATE_HEALTH_TIMEOUT  seconds the new version has (120)
#
# Paths, for tests and odd installs:
#   SPLITS_ROOT                   install root (/opt/splits)
#   SPLITS_ENV_FILE               env file (/etc/splits/splits.env)
#   SPLITS_DB_PATH                the database (/var/lib/splits/splits.db)
#   SPLITS_ADDR                   backend address (127.0.0.1:8080)
#   SPLITS_UPDATE_STATE           state file (<root>/update-state.json)
#   SPLITS_UPDATE_BACKUP_DIR      pre-update DB copies (/var/lib/splits/update-backup)
#   SPLITS_UNIT                   the unit to cycle (splits.service)
#
# Exit codes:
#   0  nothing to do, a refusal, or an update that came up healthy
#   1  an update failed and was rolled back — the Pi is on its old version
#   2  this install is not set up for unattended updates (see --status)

set -uo pipefail

MODE=run
for arg in "$@"; do
  case "$arg" in
    --check) MODE=check ;;
    --status) MODE=status ;;
    --clear-block) MODE=clear-block ;;
    -h|--help) sed -n '2,42p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf 'splits-update: %s\n' "$1"; }
warn() { printf 'splits-update: WARNING: %s\n' "$1" >&2; }
crit() { printf 'splits-update: CRITICAL: %s\n' "$1" >&2; }

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# The env file is root-owned and written by install.sh. It is parsed, not
# sourced: only SPLITS_* assignments are taken, and a variable already in
# the environment wins, so a test or an operator can override one key.

ENV_FILE="${SPLITS_ENV_FILE:-/etc/splits/splits.env}"
if [ -r "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^(SPLITS_[A-Z0-9_]+)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    [ -n "${!key+x}" ] && continue
    printf -v "$key" '%s' "$value"
  done < "$ENV_FILE"
fi

ROOT="${SPLITS_ROOT:-/opt/splits}"
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
PREVIOUS="$ROOT/previous"
BLOCKED="$ROOT/blocked"
STATE_FILE="${SPLITS_UPDATE_STATE:-$ROOT/update-state.json}"
BACKUP_DIR="${SPLITS_UPDATE_BACKUP_DIR:-/var/lib/splits/update-backup}"
DB_FILE="${SPLITS_DB_PATH:-/var/lib/splits/splits.db}"
UNIT="${SPLITS_UNIT:-splits.service}"
ENABLED="${SPLITS_UPDATE_ENABLED:-1}"
PIN="${SPLITS_UPDATE_PIN:-}"
REPO="${SPLITS_UPDATE_REPO:-dgloeckner/splits}"
HEALTH_TIMEOUT="${SPLITS_UPDATE_HEALTH_TIMEOUT:-120}"
ADDR="${SPLITS_ADDR:-127.0.0.1:8080}"
case "$ADDR" in :*) ADDR="127.0.0.1$ADDR" ;; esac
HEALTH_URL="http://$ADDR/api/health"

# Three pre-update copies: one more than a rollback needs, plus the one an
# operator restores from when a problem is only noticed days later.
KEEP_BACKUPS=3

[[ "$HEALTH_TIMEOUT" =~ ^[0-9]+$ ]] || HEALTH_TIMEOUT=120

# ---------------------------------------------------------------------------
# Release tags
# ---------------------------------------------------------------------------
# Asserted against one table of cases in deploy/test/updater-version.sh.
# The tag reaches a path and a URL, which is why it is validated first.

# A release tag as release.yml accepts it: vX.Y.Z with an optional suffix.
is_release_tag() {
  [[ "${1:-}" =~ ^v[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}(-[0-9A-Za-z.]{1,32})?$ ]]
}

# A tag this updater installs on its own: plain vX.Y.Z. `-rc` tags are
# pre-releases, `nightly` names no build at all.
is_installable_tag() {
  [[ "${1:-}" =~ ^v[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$ ]]
}

# Print -1, 0 or 1 for $1 older than, equal to, or newer than $2.
# Numeric field by field: 'v1.0.10' sorts *before* 'v1.0.9' as a string,
# and never moving backwards is this script's whole job.
compare_tags() {
  local a="${1#v}" b="${2#v}"
  local a_pre="" b_pre=""
  case "$a" in *-*) a_pre="${a#*-}"; a="${a%%-*}" ;; esac
  case "$b" in *-*) b_pre="${b#*-}"; b="${b%%-*}" ;; esac

  local i left right
  local -a a_parts b_parts
  IFS=. read -r -a a_parts <<< "$a"
  IFS=. read -r -a b_parts <<< "$b"
  for i in 0 1 2; do
    left=$((10#${a_parts[i]:-0}))
    right=$((10#${b_parts[i]:-0}))
    if [ "$left" -lt "$right" ]; then echo -1; return; fi
    if [ "$left" -gt "$right" ]; then echo 1; return; fi
  done

  compare_pre_release "$a_pre" "$b_pre"
}

# SemVer §11.4 on two pre-release suffixes, '' meaning "not a pre-release".
# Matters for a Pi a person put on an -rc by hand: `rc.9` sorts after
# `rc.10` as a string, and a refusal that reports itself as prudence
# ("never downgrading") is the worst failure this design can have.
compare_pre_release() {
  local a="$1" b="$2"
  local LC_ALL=C

  if [ "$a" = "$b" ]; then echo 0; return; fi
  if [ -z "$a" ]; then echo 1; return; fi
  if [ -z "$b" ]; then echo -1; return; fi

  local -a left right
  IFS=. read -r -a left <<< "$a"
  IFS=. read -r -a right <<< "$b"

  local count=${#left[@]} i l r
  [ "${#right[@]}" -gt "$count" ] && count=${#right[@]}

  for ((i = 0; i < count; i++)); do
    if [ "$i" -ge "${#left[@]}" ]; then echo -1; return; fi
    if [ "$i" -ge "${#right[@]}" ]; then echo 1; return; fi
    l="${left[i]}"
    r="${right[i]}"
    if [[ "$l" =~ ^[0-9]+$ ]] && [[ "$r" =~ ^[0-9]+$ ]]; then
      l="${l#"${l%%[!0]*}"}"; l="${l:-0}"
      r="${r#"${r%%[!0]*}"}"; r="${r:-0}"
      if [ "${#l}" -ne "${#r}" ]; then
        if [ "${#l}" -lt "${#r}" ]; then echo -1; else echo 1; fi
        return
      fi
      if [ "$l" != "$r" ]; then
        if [[ "$l" < "$r" ]]; then echo -1; else echo 1; fi
        return
      fi
      continue
    fi
    if [[ "$l" =~ ^[0-9]+$ ]]; then echo -1; return; fi
    if [[ "$r" =~ ^[0-9]+$ ]]; then echo 1; return; fi
    if [ "$l" != "$r" ]; then
      if [[ "$l" < "$r" ]]; then echo -1; else echo 1; fi
      return
    fi
  done
  echo 0
}

# ---------------------------------------------------------------------------
# What is installed
# ---------------------------------------------------------------------------
# The `current` symlink is the single source of truth. VERSION inside the
# slot is never read: a second copy can contradict the directory it sits
# in, and the contradiction would be silent.

installed_version() {
  [ -L "$CURRENT" ] || return 1
  local target
  target="$(readlink -f "$CURRENT")" || return 1
  [ -d "$target" ] || return 1
  [ "$(dirname "$target")" = "$(readlink -f "$RELEASES")" ] || return 1
  basename "$target"
}

previous_version() {
  [ -L "$PREVIOUS" ] && [ -d "$(readlink -f "$PREVIOUS")" ] && basename "$(readlink -f "$PREVIOUS")"
}

blocked_tags() {
  [ -f "$BLOCKED" ] && grep -v '^[[:space:]]*$' "$BLOCKED" || true
}

is_blocked() {
  blocked_tags | grep -qxF "$1"
}

# ---------------------------------------------------------------------------
# The state file — what Profil shows (GET /api/v1/update-status)
# ---------------------------------------------------------------------------
# Written on every run, --check included. This script is the one place that
# compares two tags, so it is also the one that names the state; the
# backend only passes it on.

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

state_field() {
  [ -f "$STATE_FILE" ] || return 0
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$STATE_FILE" | head -n1
}

# One of current | behind | stuck | unknown | off.
derive_state() {
  local installed="$1" latest="$2"
  if [ "$ENABLED" = 0 ]; then echo off; return; fi
  if ! is_release_tag "$installed" || ! is_installable_tag "$latest"; then echo unknown; return; fi
  if [ "$(compare_tags "$latest" "$installed")" = 1 ]; then
    if is_blocked "$latest"; then echo stuck; else echo behind; fi
    return
  fi
  echo current
}

# write_state <result> <message>; reads INSTALLED and LATEST.
write_state() {
  local result="$1" message="$2" state blocked_json="" tag tmp
  [ -d "$(dirname "$STATE_FILE")" ] || return 0
  state="$(derive_state "${INSTALLED:-}" "${LATEST:-}")"
  [ "$result" = hand-managed ] && state=unknown
  while IFS= read -r tag; do
    is_release_tag "$tag" || continue
    blocked_json="${blocked_json:+$blocked_json, }\"$tag\""
  done < <(blocked_tags)
  tmp="$STATE_FILE.tmp.$$"
  cat > "$tmp" <<JSON
{
  "checked_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "installed": "$(json_escape "${INSTALLED:-}")",
  "previous": "$(json_escape "$(previous_version || true)")",
  "latest": "$(json_escape "${LATEST:-}")",
  "state": "$state",
  "result": "$result",
  "message": "$(json_escape "$message")",
  "blocked": [$blocked_json]
}
JSON
  chmod 0644 "$tmp" 2>/dev/null
  mv -f "$tmp" "$STATE_FILE" || rm -f "$tmp"
}

# A refusal: log it, record it, exit 0.
refuse() {
  local result="$1" message="$2"
  log "$message"
  write_state "$result" "$message"
  exit 0
}

# ---------------------------------------------------------------------------
# --status / --clear-block
# ---------------------------------------------------------------------------

if [ "$MODE" = status ]; then
  echo "install root:  $ROOT"
  echo "installed:     $(installed_version || echo "(no release slot — $CURRENT is not a link into $RELEASES)")"
  echo "previous:      $(previous_version || echo '(none)')"
  echo "blocked:       $(blocked_tags | tr '\n' ' ')"
  echo "architecture:  $(cat "$CURRENT/ARCH" 2>/dev/null || echo '(no ARCH in the current slot)')"
  echo "repository:    $REPO"
  echo "pinned to:     ${PIN:-(not pinned)}"
  echo "updates:       $([ "$ENABLED" = 0 ] && echo 'off (SPLITS_UPDATE_ENABLED=0)' || echo 'on, nightly at 04:30')"
  if [ -f "$STATE_FILE" ]; then
    echo "last run:      $(state_field checked_at) — $(state_field result): $(state_field message)"
    echo "state:         $(state_field state) (latest seen: $(state_field latest))"
  else
    echo "last run:      (never — no $STATE_FILE)"
  fi
  inst="$(installed_version || true)"
  if [ -n "$inst" ] && ! is_installable_tag "$inst" && ! is_release_tag "$inst"; then
    echo
    echo "'$inst' is not a release tag: this is a hand-managed install the updater"
    echo "leaves alone. Install a tagged release with its deploy/install.sh to hand it over."
  fi
  exit 0
fi

if [ "$MODE" = clear-block ]; then
  # Deliberately a human act. The updater never un-blocks a tag on its own:
  # it blocked it because installing it produced a backend that did not
  # come back, and retrying that automatically is worse than standing still.
  rm -f "$BLOCKED"
  INSTALLED="$(installed_version || true)"
  LATEST="$(state_field latest)"
  log "cleared the blocked list; the next run may install the latest release again"
  write_state cleared "the blocked list was cleared by hand"
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Is this install set up for unattended updates?
# ---------------------------------------------------------------------------

LATEST="$(state_field latest)"   # carried over until GitHub answers

if ! INSTALLED="$(installed_version)"; then
  INSTALLED=""
  msg="$CURRENT is not a link to a release slot under $RELEASES; nothing was changed. Install a tagged release with deploy/install.sh."
  warn "$msg"
  write_state hand-managed "$msg"
  exit 2
fi

if ! is_release_tag "$INSTALLED"; then
  msg="the installed slot is '$INSTALLED', which is not a release tag — a hand-managed install. Nothing was changed."
  warn "$msg"
  write_state hand-managed "$msg"
  exit 2
fi

ARCH="$(head -n1 "$CURRENT/ARCH" 2>/dev/null | tr -d '[:space:]')"
if [[ ! "$ARCH" =~ ^linux-[0-9a-z]+$ ]]; then
  msg="the installed slot $INSTALLED has no usable ARCH file, so there is no way to pick an asset. Nothing was changed."
  warn "$msg"
  write_state hand-managed "$msg"
  exit 2
fi

# ---------------------------------------------------------------------------
# 2. Switched off?
# ---------------------------------------------------------------------------

if [ "$ENABLED" = 0 ]; then
  refuse off "updates are off (SPLITS_UPDATE_ENABLED=0); staying on $INSTALLED"
fi

# Two runs at once (the timer and a person) would race on the symlinks.
if [ "$MODE" = run ] && command -v flock >/dev/null 2>&1; then
  exec 9> "$ROOT/.update.lock" || refuse refused "cannot write $ROOT — not running as root?"
  flock -n 9 || { log "another update run holds $ROOT/.update.lock; leaving it alone"; exit 0; }
fi

# ---------------------------------------------------------------------------
# 3. What is the latest release?
# ---------------------------------------------------------------------------

if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  refuse refused "SPLITS_UPDATE_REPO '$REPO' is not owner/name; no update"
fi
if [ -n "$PIN" ] && ! is_installable_tag "$PIN"; then
  refuse refused "SPLITS_UPDATE_PIN '$PIN' is not a plain vX.Y.Z tag; no update"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/splits-update.XXXXXX")" || refuse refused "could not create a work directory"
cleanup() {
  case "$WORK" in
    "${TMPDIR:-/tmp}"/splits-update.*) rm -rf "$WORK" ;;
  esac
}
trap cleanup EXIT

if [ -n "$PIN" ]; then
  LOOKUP="https://api.github.com/repos/$REPO/releases/tags/$PIN"
else
  LOOKUP="https://api.github.com/repos/$REPO/releases/latest"
fi
# Not `if ! curl`: `!` rewrites the exit status, and the status separates
# "GitHub answered with an error" (22) from "GitHub was not there".
curl -fsS --max-time 30 --retry 3 --retry-delay 5 \
  -H 'Accept: application/vnd.github+json' -o "$WORK/release.json" "$LOOKUP" 2>/dev/null
LOOKUP_STATUS=$?
if [ "$LOOKUP_STATUS" = 22 ]; then
  refuse refused "GitHub has no release at $LOOKUP; no update"
elif [ "$LOOKUP_STATUS" != 0 ]; then
  refuse unreachable "could not reach GitHub (curl exit $LOOKUP_STATUS); no update tonight"
fi

TAG="$(tr ',' '\n' < "$WORK/release.json" \
  | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"

if ! is_installable_tag "$TAG"; then
  # Validated before the tag reaches a path or a URL.
  LATEST=""
  refuse refused "the latest release is tagged '${TAG:-<none>}', which is not a plain vX.Y.Z; no update"
fi
LATEST="$TAG"
log "installed $INSTALLED, latest release $TAG${PIN:+ (pinned)}"

# ---------------------------------------------------------------------------
# 4. Is there anything to do?
# ---------------------------------------------------------------------------

ORDER="$(compare_tags "$TAG" "$INSTALLED")"
if [ "$ORDER" = 0 ]; then
  refuse current "installed $INSTALLED is the latest release; nothing to do"
fi
if [ "$ORDER" = -1 ]; then
  # Moving backwards means running a migration backwards, and the
  # pre-update backup that would make that safe is long gone.
  warn "the latest release $TAG is older than the installed $INSTALLED. Never downgrading."
  write_state downgrade "the latest release $TAG is older than the installed $INSTALLED; never downgrading"
  exit 0
fi

# ---------------------------------------------------------------------------
# 5. Blocked?
# ---------------------------------------------------------------------------

if is_blocked "$TAG"; then
  refuse blocked "$TAG failed on this Pi before and is blocked; staying on $INSTALLED until a newer release exists or --clear-block is run"
fi

# ---------------------------------------------------------------------------
# 6. Is anybody rowing?
# ---------------------------------------------------------------------------

UNIT_STATE="$(systemctl is-active "$UNIT" 2>/dev/null)"
case "$UNIT_STATE" in
  inactive|failed)
    # Nothing can be writing the database. This is also how a crashed
    # backend gets fixed over the air.
    log "$UNIT is $UNIT_STATE; nothing is writing the database"
    ;;
  active)
    HEALTH="$(curl -fsS --max-time 10 "$HEALTH_URL" 2>/dev/null)" ||
      refuse busy "$UNIT is active but $HEALTH_URL does not answer; unknown is not idle, no update"
    if printf '%s' "$HEALTH" | grep -q '"session_open"[[:space:]]*:[[:space:]]*true'; then
      refuse busy "a session is open; no update while somebody is rowing"
    fi
    if ! printf '%s' "$HEALTH" | grep -q '"session_open"[[:space:]]*:[[:space:]]*false'; then
      refuse busy "$HEALTH_URL does not say whether a session is open; unknown is not idle, no update"
    fi
    ;;
  *)
    refuse busy "$UNIT is '${UNIT_STATE:-unknown}'; no update until it is settled"
    ;;
esac

# ---------------------------------------------------------------------------
# 7. Fetch and verify
# ---------------------------------------------------------------------------

ASSET="splits-$ARCH-$TAG.tar.gz"
if ! grep -qF "\"name\": \"$ASSET\"" "$WORK/release.json" && ! grep -qF "\"name\":\"$ASSET\"" "$WORK/release.json"; then
  refuse refused "release $TAG has no $ASSET; no update"
fi
if ! grep -qF '"SHA256SUMS"' "$WORK/release.json"; then
  refuse refused "release $TAG publishes no SHA256SUMS; refusing to install unverified"
fi

if [ "$MODE" = check ]; then
  refuse would-update "would update $INSTALLED -> $TAG using $ASSET"
fi

DOWNLOAD="https://github.com/$REPO/releases/download/$TAG"
log "downloading $ASSET"
curl -fsSL --max-time 900 --retry 3 --retry-delay 5 -o "$WORK/$ASSET" "$DOWNLOAD/$ASSET" 2>/dev/null ||
  refuse unreachable "download of $ASSET failed; no update tonight"
curl -fsSL --max-time 60 --retry 3 --retry-delay 5 -o "$WORK/SHA256SUMS" "$DOWNLOAD/SHA256SUMS" 2>/dev/null ||
  refuse unreachable "download of SHA256SUMS failed; no update tonight"

# TLS authenticates the host; the checksum is what catches a truncated
# download, which extracts into a bundle that starts and then fails.
if ! awk -v a="$ASSET" '$1 ~ /^[0-9a-f]{64}$/ && ($2 == a || $2 == "*" a) { found = 1 } END { exit !found }' "$WORK/SHA256SUMS"; then
  refuse refused "SHA256SUMS of $TAG has no line for $ASSET; refusing to install unverified"
fi
if ! (cd "$WORK" && sha256sum -c --ignore-missing --quiet SHA256SUMS >/dev/null 2>&1); then
  refuse refused "checksum mismatch for $ASSET; refusing to install"
fi
log "checksum verified"

# Staged first: a slot is only ever named after a tag once it is complete,
# so a power loss mid-extract leaves a `.incoming` directory the next run
# overwrites, never a half-filled releases/$TAG.
STAGE="$RELEASES/.incoming-$TAG"
rm -rf "$STAGE"
mkdir -p "$STAGE" || refuse refused "cannot write $RELEASES — not running as root?"
if ! tar -xzf "$WORK/$ASSET" -C "$STAGE" --strip-components=1 --no-same-owner 2>/dev/null; then
  rm -rf "$STAGE"
  refuse refused "could not extract $ASSET; no update"
fi
if [ ! -x "$STAGE/bin/splits" ] || [ ! -f "$STAGE/web/dist/index.html" ]; then
  rm -rf "$STAGE"
  refuse refused "$ASSET has no executable bin/splits or no web/dist/index.html; refusing to install"
fi
if [ "$(head -n1 "$STAGE/VERSION" 2>/dev/null)" != "$TAG" ]; then
  rm -rf "$STAGE"
  refuse refused "$ASSET says it is '$(head -n1 "$STAGE/VERSION" 2>/dev/null)', not $TAG; refusing to install"
fi
chmod -R go-w "$STAGE"
rm -rf "${RELEASES:?}/$TAG"
mv "$STAGE" "$RELEASES/$TAG"

# ---------------------------------------------------------------------------
# 8. Stop, back up, swap, start
# ---------------------------------------------------------------------------
# Stopped *before* the copy: copying a SQLite file out from under a writer
# can tear it between two transactions, and the one moment the copy
# matters is the rollback, where it is all that stands between a failed
# update and lost sessions.

swap_link() {
  ln -sfn "$1" "$2.new" && mv -Tf "$2.new" "$2"
}

# Sets RUNNING to the version /api/health reports, waiting up to $2 s for $1.
wait_for_version() {
  local want="$1" timeout="$2" deadline body
  deadline=$(( $(date +%s) + timeout ))
  RUNNING=""
  while :; do
    body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
    RUNNING="$(printf '%s' "$body" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
    [ "$RUNNING" = "$want" ] && return 0
    [ "$(date +%s)" -ge "$deadline" ] && return 1
    sleep 2
  done
}

OLD_PREVIOUS="$(readlink "$PREVIOUS" 2>/dev/null || true)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_DIR/splits-$INSTALLED-$STAMP.db"

log "stopping $UNIT"
systemctl stop "$UNIT" || warn "could not stop $UNIT; continuing"

install -d -m 0700 "$BACKUP_DIR" 2>/dev/null || mkdir -p "$BACKUP_DIR"
backup_ok=1
HAD_DB=0
if [ -f "$DB_FILE" ]; then
  HAD_DB=1
  cp -a "$DB_FILE" "$BACKUP" || backup_ok=0
  for ext in -wal -shm; do
    if [ -f "$DB_FILE$ext" ]; then cp -a "$DB_FILE$ext" "$BACKUP$ext" || backup_ok=0; fi
  done
fi
if [ "$backup_ok" != 1 ]; then
  rm -f "$BACKUP" "$BACKUP-wal" "$BACKUP-shm"
  rm -rf "${RELEASES:?}/$TAG"
  systemctl start "$UNIT" || warn "could not start $UNIT again"
  warn "could not back up $DB_FILE to $BACKUP_DIR; nothing was changed"
  write_state failed "could not back up the database before updating to $TAG; nothing was changed"
  exit 1
fi
if [ "$HAD_DB" = 1 ]; then
  log "database backed up to $BACKUP"
else
  log "no database at $DB_FILE yet; nothing to back up"
fi

swap_link "$RELEASES/$INSTALLED" "$PREVIOUS"
if ! swap_link "$RELEASES/$TAG" "$CURRENT"; then
  swap_link "${OLD_PREVIOUS:-$RELEASES/$INSTALLED}" "$PREVIOUS"
  rm -rf "${RELEASES:?}/$TAG"
  systemctl start "$UNIT"
  warn "could not swap $CURRENT; staying on $INSTALLED"
  write_state failed "could not swap the current link to $TAG; nothing was changed"
  exit 1
fi
log "current -> $TAG"
systemctl start "$UNIT" || warn "could not start $UNIT"

# ---------------------------------------------------------------------------
# 9. Health window
# ---------------------------------------------------------------------------
# Equality is the test: /api/health must report $TAG, which proves the new
# binary is the one serving, not a stale process that never went away.

log "waiting up to ${HEALTH_TIMEOUT}s for /api/health to report $TAG"
if wait_for_version "$TAG" "$HEALTH_TIMEOUT"; then
  log "$TAG is healthy; update complete"
  # One generation is kept: previous is the rollback target.
  for slot in "$RELEASES"/* "$RELEASES"/.incoming-*; do
    [ -d "$slot" ] || continue
    name="$(basename "$slot")"
    [ "$name" = "$TAG" ] && continue
    [ "$name" = "$INSTALLED" ] && continue
    rm -rf "${RELEASES:?}/$name"
  done
  ls -1t "$BACKUP_DIR"/splits-*.db 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | while IFS= read -r old; do
    rm -f "$old" "$old-wal" "$old-shm"
  done
  INSTALLED="$TAG"
  write_state updated "updated to $TAG"
  exit 0
fi

# ---------------------------------------------------------------------------
# 10. Rollback
# ---------------------------------------------------------------------------
# Safe because this runs at night with no session open: a version that never
# came up healthy recorded nothing, so restoring the pre-update database
# loses nothing — and undoes any migration the failed version applied.
# Health is local, so a missing answer *is* a verdict on the build.

warn "$TAG did not report healthy within ${HEALTH_TIMEOUT}s (last answer: ${RUNNING:-none}); rolling back to $INSTALLED"
systemctl stop "$UNIT" || warn "could not stop $UNIT during rollback"
swap_link "$RELEASES/$INSTALLED" "$CURRENT" || crit "could not swap $CURRENT back to $INSTALLED"
if [ -n "$OLD_PREVIOUS" ]; then swap_link "$OLD_PREVIOUS" "$PREVIOUS"; else rm -f "$PREVIOUS"; fi

if [ "$HAD_DB" = 1 ]; then
  restored=1
  cp -a "$BACKUP" "$DB_FILE" || restored=0
  for ext in -wal -shm; do
    if [ -f "$BACKUP$ext" ]; then
      cp -a "$BACKUP$ext" "$DB_FILE$ext" || restored=0
    else
      # The failed version may have opened the DB; its journal belongs to
      # it, not to the copy being restored.
      rm -f "$DB_FILE$ext"
    fi
  done
  if [ "$restored" = 1 ]; then log "database restored from $BACKUP"; else crit "could not restore $DB_FILE from $BACKUP"; fi
else
  rm -f "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm"
fi
log "current -> $INSTALLED"

printf '%s\n' "$TAG" >> "$BLOCKED"
rm -rf "${RELEASES:?}/$TAG"

systemctl start "$UNIT" || warn "could not start $UNIT after rollback"
if wait_for_version "$INSTALLED" "$HEALTH_TIMEOUT"; then
  log "$INSTALLED is serving again"
  warn "rolled back to $INSTALLED and blocked $TAG; nothing is installed until a newer release exists or --clear-block is run"
  write_state rolled-back "update to $TAG failed and was rolled back; still running $INSTALLED"
else
  crit "$INSTALLED did not come back either (last answer: ${RUNNING:-none}). This Pi needs a person: journalctl -u $UNIT"
  write_state rollback-failed "update to $TAG failed, and $INSTALLED did not come back after the rollback"
fi
exit 1
