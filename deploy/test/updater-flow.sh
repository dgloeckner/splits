#!/usr/bin/env bash
#
# updater-flow.sh — what splits-update.sh does to a Pi.
#
# The updater's claims are mostly about *not* acting: ADR-0023 lists its
# refusals and says all of them are "no update", never an error. The one
# worth the most is the rollback, and it is also the one nobody will ever
# exercise by hand — it needs a release that installs and then does not
# come up.
#
# So this drives the real script against a sandbox: a temp install root, a
# temp env file and database, a `curl` that serves fixtures (GitHub and the
# local /api/health), a `systemctl` that records what it was asked and can
# pretend the service came up — or did not — and a `cp` that records when
# the database was copied. Nothing here touches /opt, the network or a real
# systemd. (FEAT-0016 stage 3; cases E1–E10 are the issue's.)
#
# Usage: bash deploy/test/updater-flow.sh      (exit 0 = all cases pass)

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UPDATER="$HERE/../splits-update.sh"

FAILURES=0
pass() { printf '[ OK ]  %s\n' "$1"; }
fail() { FAILURES=$((FAILURES + 1)); printf '[FAIL]  %s\n' "$1"; }

# Cases point TMPDIR into their own directory, so remember the real one.
TMP_BASE="${TMPDIR:-/tmp}"
SANDBOX="$(mktemp -d "$TMP_BASE/splits-updater-test.XXXXXX")"
# Never delete a path this run did not create: an unset variable here would
# otherwise expand to `rm -rf /`.
cleanup() {
  case "$SANDBOX" in
    "$TMP_BASE"/splits-updater-test.?*) rm -rf "$SANDBOX" ;;
    *) echo "refusing to clean up '$SANDBOX'" >&2 ;;
  esac
}
trap cleanup EXIT

ARCH=linux-amd64
CASE=0

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------

STUB_BIN="$SANDBOX/bin"
mkdir -p "$STUB_BIN"

cat > "$STUB_BIN/curl" <<'STUB'
#!/usr/bin/env bash
# Serves $FIXTURES for GitHub and $SVC/health.json for the local backend.
# Exit codes are real curl's: 22 for an HTTP error under -f, 6 for a host
# that does not resolve, 7 for a refused connection.
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -H|--max-time|--retry|--retry-delay) shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
echo "$url" >> "$CURL_LOG"
serve() { [ -f "$1" ] || exit 22; if [ -n "$out" ]; then cat "$1" > "$out"; else cat "$1"; fi; }
case "$url" in
  http://127.0.0.1:8080/api/health)
    [ -f "$SVC/health.json" ] || exit 7
    serve "$SVC/health.json" ;;
  https://api.github.com/*)
    [ -f "$FIXTURES/github-down" ] && exit 6
    case "$url" in
      */releases/latest) serve "$FIXTURES/latest.json" ;;
      */releases/tags/*) serve "$FIXTURES/release-${url##*/}.json" ;;
      *) exit 22 ;;
    esac ;;
  https://github.com/*/releases/download/*)
    [ -f "$FIXTURES/github-down" ] && exit 6
    rest="${url#*/releases/download/}"
    serve "$FIXTURES/assets/$rest" ;;
  *) exit 22 ;;
esac
STUB

cat > "$STUB_BIN/systemctl" <<'STUB'
#!/usr/bin/env bash
# Stands in for splits.service. `start` serves /api/health with the version
# of whatever `current` points at — unless that tag is listed in
# $SVC/broken, in which case it "crash-loops": no health, but it does get
# far enough to migrate the database (an appended line plus a -wal file),
# which is what the rollback has to undo.
cmd="$1"; unit="${2:-}"
db="$(sed -n 's/^SPLITS_DB_PATH=//p' "$SPLITS_ENV_FILE")"
case "$cmd" in
  is-active)
    state="$(cat "$SVC/state")"; echo "$state"
    [ "$state" = active ] ;;
  stop)
    echo "stop $unit" >> "$EVENTS"
    echo inactive > "$SVC/state"; rm -f "$SVC/health.json" ;;
  start)
    tag="$(basename "$(readlink -f "$SPLITS_ROOT/current")")"
    echo "start $unit $tag" >> "$EVENTS"
    echo active > "$SVC/state"
    if grep -qxF "$tag" "$SVC/broken" 2>/dev/null; then
      echo "migrated by $tag" >> "$db"
      echo "wal of $tag" > "$db-wal"
      rm -f "$SVC/health.json"
    else
      printf '{"commit":"abc1234","session_open":%s,"status":"ok","version":"%s"}\n' \
        "$(cat "$SVC/session_open")" "$tag" > "$SVC/health.json"
    fi ;;
  *) echo "systemctl stub: unexpected $*" >&2; exit 1 ;;
esac
STUB

cat > "$STUB_BIN/cp" <<'STUB'
#!/usr/bin/env bash
# Records which file was copied, so the order stop → copy → start can be
# asserted, then copies it for real.
for last in "$@"; do :; done
src=""; for a in "$@"; do case "$a" in -*) ;; *) [ -z "$src" ] && src="$a" ;; esac; done
echo "cp $(basename "$src")" >> "$EVENTS"
exec /bin/cp "$@"
STUB

chmod +x "$STUB_BIN"/*
export PATH="$STUB_BIN:$PATH"

# ---------------------------------------------------------------------------
# The sandbox
# ---------------------------------------------------------------------------

# A slot as install.sh / the updater leave it.
make_slot() {
  local dir="$1" tag="$2"
  mkdir -p "$dir/bin" "$dir/web/dist" "$dir/deploy"
  printf '#!/bin/sh\nexit 0\n' > "$dir/bin/splits"
  chmod +x "$dir/bin/splits"
  echo "<!-- $tag -->" > "$dir/web/dist/index.html"
  printf '%s\nabc1234\n' "$tag" > "$dir/VERSION"
  echo "$ARCH" > "$dir/ARCH"
}

# publish <tag> [latest]: a Release with this Pi's asset, one for another
# board, and SHA256SUMS listing both (so --ignore-missing is exercised).
publish() {
  local tag="$1"
  local bundle="$SANDBOX/build/splits-$ARCH-$tag" assets="$FIXTURES/assets/$tag"
  rm -rf "$bundle"; mkdir -p "$assets"
  make_slot "$bundle" "$tag"
  tar -czf "$assets/splits-$ARCH-$tag.tar.gz" -C "$SANDBOX/build" "splits-$ARCH-$tag"
  echo "not really armv7" > "$assets/splits-linux-armv7-$tag.tar.gz"
  (cd "$assets" && sha256sum ./*.tar.gz | sed 's| \./| |' > SHA256SUMS)
  release_json "$tag" "splits-$ARCH-$tag.tar.gz" "splits-linux-armv7-$tag.tar.gz" SHA256SUMS
  if [ "${2:-}" = latest ]; then cp "$FIXTURES/release-$tag.json" "$FIXTURES/latest.json"; fi
}

# release_json <tag> <asset names...>, pretty-printed the way GitHub does.
release_json() {
  local tag="$1"; shift
  {
    printf '{\n  "tag_name": "%s",\n  "prerelease": false,\n  "assets": [\n' "$tag"
    local first=1 name
    for name in "$@"; do
      [ "$first" = 1 ] || printf ',\n'
      first=0
      printf '    {\n      "name": "%s",\n      "browser_download_url": "https://github.com/test/splits/releases/download/%s/%s"\n    }' "$name" "$tag" "$name"
    done
    printf '\n  ]\n}\n'
  } > "$FIXTURES/release-$tag.json"
}

# Every case starts from a fresh Pi on v0.4.1 (previous v0.4.0, an older
# v0.3.0 slot still lying around), service up and idle, v0.4.2 released.
setup_case() {
  CASE=$((CASE + 1))
  local c="$SANDBOX/case-$CASE"
  export SPLITS_ROOT="$c/opt"
  export SPLITS_ENV_FILE="$c/etc/splits.env"
  export SPLITS_UPDATE_BACKUP_DIR="$c/var/update-backup"
  export FIXTURES="$c/fixtures" SVC="$c/svc" EVENTS="$c/events.log" CURL_LOG="$c/curl.log"
  export TMPDIR="$c/tmp"
  DB="$c/var/splits.db"
  mkdir -p "$SPLITS_ROOT/releases" "$c/etc" "$c/var" "$FIXTURES/assets" "$SVC" "$TMPDIR"
  : > "$EVENTS"; : > "$CURL_LOG"

  for t in v0.3.0 v0.4.0 v0.4.1; do make_slot "$SPLITS_ROOT/releases/$t" "$t"; done
  ln -sfn "$SPLITS_ROOT/releases/v0.4.1" "$SPLITS_ROOT/current"
  ln -sfn "$SPLITS_ROOT/releases/v0.4.0" "$SPLITS_ROOT/previous"

  cat > "$SPLITS_ENV_FILE" <<ENV
SPLITS_ADDR=127.0.0.1:8080
SPLITS_DB_PATH=$DB
SPLITS_UPDATE_REPO=test/splits
SPLITS_UPDATE_HEALTH_TIMEOUT=4
ENV
  printf 'household data %s\n' "$CASE" > "$DB"
  cp "$DB" "$c/db.orig"
  DB_ORIG="$c/db.orig"
  : > "$EVENTS"

  echo false > "$SVC/session_open"
  : > "$SVC/broken"
  echo active > "$SVC/state"
  printf '{"commit":"abc1234","session_open":false,"status":"ok","version":"v0.4.1"}\n' > "$SVC/health.json"

  publish v0.4.1
  publish v0.4.2 latest
}

env_set() { echo "$1" >> "$SPLITS_ENV_FILE"; }

run_updater() {
  : > "$EVENTS"; : > "$CURL_LOG"
  OUTPUT="$(bash "$UPDATER" "$@" 2>&1)"
  STATUS=$?
}

installed() { basename "$(readlink -f "$SPLITS_ROOT/current")"; }
previous()  { basename "$(readlink -f "$SPLITS_ROOT/previous")"; }
state()     { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$SPLITS_ROOT/update-state.json" 2>/dev/null | head -n1; }
slots()     { (cd "$SPLITS_ROOT/releases" && ls -A | tr '\n' ' '); }

expect_status()    { if [ "$STATUS" = "$1" ]; then pass "$2"; else fail "$2 (exit $STATUS, expected $1) — output: $OUTPUT"; fi; }
expect_installed() { local got; got="$(installed)"; if [ "$got" = "$1" ]; then pass "$2"; else fail "$2 (installed $got, expected $1)"; fi; }
expect_output()    { if printf '%s' "$OUTPUT" | grep -qF -- "$1"; then pass "$2"; else fail "$2 — output was: $OUTPUT"; fi; }
expect_state()     { local got; got="$(state "$1")"; if [ "$got" = "$2" ]; then pass "$3"; else fail "$3 ($1=$got, expected $2)"; fi; }
expect_true()      { local what="$1"; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }
expect_untouched() {
  if grep -q '^stop\|^start' "$EVENTS"; then fail "$1 (the service was touched: $(tr '\n' ';' < "$EVENTS"))"; else pass "$1"; fi
}
expect_no_download() {
  if grep -q '/releases/download/' "$CURL_LOG"; then fail "$1 (downloaded: $(grep '/releases/download/' "$CURL_LOG" | tr '\n' ' '))"; else pass "$1"; fi
}
expect_no_new_slot() {
  if [ -e "$SPLITS_ROOT/releases/$1" ] || compgen -G "$SPLITS_ROOT/releases/.incoming-*" >/dev/null; then
    fail "$2 (slots: $(slots))"
  else
    pass "$2"
  fi
}
# The events, in order, as one line: "stop ...;cp ...;start ...;".
events() { tr '\n' ';' < "$EVENTS"; }
expect_events() { local got; got="$(events)"; if [ "$got" = "$1" ]; then pass "$2"; else fail "$2 (events: $got, expected $1)"; fi; }

# ---------------------------------------------------------------------------
# --check and --status
# ---------------------------------------------------------------------------

echo "== --check / --status =="

setup_case
publish v0.4.1 latest
run_updater --check
expect_status 0 "--check on an up-to-date Pi exits 0"
expect_output "installed v0.4.1, latest release v0.4.1" "--check names the installed version and the latest release"
expect_untouched "--check does not touch the service"
expect_state state current "--check writes the state file: current"

setup_case
run_updater --check
expect_status 0 "--check with a newer release exits 0"
expect_output "would update v0.4.1 -> v0.4.2" "--check says what it would do"
expect_installed v0.4.1 "--check changes nothing"
expect_no_download "--check downloads nothing"
expect_untouched "--check does not touch the service"
expect_state state behind "--check records behind"
expect_state result would-update "--check records what it would do"

run_updater --status
expect_status 0 "--status exits 0"
expect_output "installed:     v0.4.1" "--status names the installed version"
expect_output "previous:      v0.4.0" "--status names the previous version"
expect_output "state:         behind (latest seen: v0.4.2)" "--status shows the last verdict"

# ---------------------------------------------------------------------------
# The refusals — all "no update", none an error
# ---------------------------------------------------------------------------

echo
echo "== refusals =="

setup_case                                         # E1
touch "$FIXTURES/github-down"
run_updater
expect_status 0 "E1 an unreachable GitHub is not an error"
expect_output "could not reach GitHub" "E1 the reason is named"
expect_installed v0.4.1 "E1 nothing changes"
expect_untouched "E1 the service is not touched"
expect_state result unreachable "E1 recorded as unreachable"

setup_case                                         # E2
publish v0.5.0-rc1 latest
run_updater
expect_status 0 "E2 a pre-release tag is not an error"
expect_output "not a plain vX.Y.Z" "E2 a pre-release tag is refused by name"
expect_installed v0.4.1 "E2 a pre-release tag changes nothing"
expect_no_download "E2 nothing is downloaded"
release_json nightly "splits-$ARCH-nightly.tar.gz" SHA256SUMS
cp "$FIXTURES/release-nightly.json" "$FIXTURES/latest.json"
run_updater
expect_status 0 "E2 a 'nightly' tag is not an error"
expect_installed v0.4.1 "E2 'nightly' is never installed"
expect_state state unknown "E2 an unusable latest tag reads as unknown"

setup_case                                         # E3
publish v0.4.0 latest
run_updater
expect_status 0 "E3 an older release is not an error"
expect_output "Never downgrading" "E3 an older release is refused, loudly"
expect_installed v0.4.1 "E3 the Pi never moves backwards"
expect_untouched "E3 the service is not touched"

setup_case                                         # E4
release_json v0.4.2 "splits-linux-armv7-v0.4.2.tar.gz" SHA256SUMS
cp "$FIXTURES/release-v0.4.2.json" "$FIXTURES/latest.json"
run_updater
expect_status 0 "E4 no asset for this ARCH is not an error"
expect_output "has no splits-$ARCH-v0.4.2.tar.gz" "E4 the missing asset is named"
expect_installed v0.4.1 "E4 nothing changes"
expect_no_download "E4 nothing is downloaded"

setup_case                                         # E5 no sum line
grep -v "splits-$ARCH-" "$FIXTURES/assets/v0.4.2/SHA256SUMS" > "$SANDBOX/sums" && mv "$SANDBOX/sums" "$FIXTURES/assets/v0.4.2/SHA256SUMS"
run_updater
expect_status 0 "E5 a missing checksum line is not an error"
expect_output "has no line for splits-$ARCH-v0.4.2.tar.gz" "E5 the missing checksum is named"
expect_installed v0.4.1 "E5 an unverifiable bundle is not installed"
expect_no_new_slot v0.4.2 "E5 no slot is left behind"
expect_untouched "E5 the service is not touched"

setup_case                                         # E5 mismatch
echo "truncated" >> "$FIXTURES/assets/v0.4.2/splits-$ARCH-v0.4.2.tar.gz"
run_updater
expect_status 0 "E5 a checksum mismatch is not an error"
expect_output "checksum mismatch" "E5 the mismatch is named"
expect_installed v0.4.1 "E5 a corrupt bundle is not installed"
expect_no_new_slot v0.4.2 "E5 no slot is left behind after a mismatch"

setup_case                                         # E5 no SHA256SUMS at all
release_json v0.4.2 "splits-$ARCH-v0.4.2.tar.gz"
cp "$FIXTURES/release-v0.4.2.json" "$FIXTURES/latest.json"
run_updater
expect_status 0 "E5 a release without SHA256SUMS is not an error"
expect_output "publishes no SHA256SUMS" "E5 the missing SHA256SUMS is named"
expect_installed v0.4.1 "E5 nothing is installed unverified"

setup_case                                         # E6 session open
echo true > "$SVC/session_open"
printf '{"commit":"abc1234","session_open":true,"status":"ok","version":"v0.4.1"}\n' > "$SVC/health.json"
run_updater
expect_status 0 "E6 an open session is not an error"
expect_output "a session is open" "E6 the open session is named"
expect_installed v0.4.1 "E6 nobody is updated mid-session"
expect_untouched "E6 the service is not touched"
expect_state result busy "E6 recorded as busy"
expect_state state behind "E6 busy is still behind, not stuck"

setup_case                                         # E6 health unknown
rm -f "$SVC/health.json"
run_updater
expect_status 0 "E6 an active service that does not answer is not an error"
expect_output "unknown is not idle" "E6 unknown is not idle"
expect_installed v0.4.1 "E6 unknown health stops the update"
expect_untouched "E6 the service is not touched"

setup_case                                         # E6 crashed backend
echo failed > "$SVC/state"; rm -f "$SVC/health.json"
run_updater
expect_status 0 "E6 a failed service is updated"
expect_installed v0.4.2 "E6 a crashed backend is fixed over the air"

setup_case                                         # E7 no slot
rm "$SPLITS_ROOT/current"; mkdir "$SPLITS_ROOT/current"
run_updater
expect_status 2 "E7 a flat current exits 2"
expect_untouched "E7 the service is not touched"
expect_state result hand-managed "E7 recorded as hand-managed"
expect_state state unknown "E7 shown as unknown"

setup_case                                         # E7 dev slot
make_slot "$SPLITS_ROOT/releases/v0.4.1-3-gabc1234-dirty" dev
ln -sfn "$SPLITS_ROOT/releases/v0.4.1-3-gabc1234-dirty" "$SPLITS_ROOT/current"
run_updater
expect_status 2 "E7 a git-describe slot exits 2"
expect_output "hand-managed" "E7 the reason is named"
expect_no_download "E7 nothing is downloaded"
run_updater --status
expect_output "hand-managed install" "E7 --status says so"

setup_case                                         # E7 no ARCH
rm "$SPLITS_ROOT/releases/v0.4.1/ARCH"
run_updater
expect_status 2 "E7 a slot without ARCH exits 2"
expect_installed v0.4.1 "E7 nothing changes"

setup_case                                         # E8
echo v0.4.2 > "$SPLITS_ROOT/blocked"
run_updater
expect_status 0 "E8 a blocked tag is not an error"
expect_output "is blocked" "E8 the blocked tag is named"
expect_installed v0.4.1 "E8 a blocked tag is never retried"
expect_untouched "E8 the service is not touched"
expect_state state stuck "E8 shown as stuck"

setup_case                                         # E9
env_set SPLITS_UPDATE_ENABLED=0
run_updater
expect_status 0 "E9 updates off is not an error"
expect_output "updates are off" "E9 opting out is named"
expect_installed v0.4.1 "E9 nothing changes"
expect_true "E9 GitHub is not asked" test ! -s "$CURL_LOG"
expect_state state off "E9 shown as off"

setup_case                                         # E10
publish v0.4.3 latest
env_set SPLITS_UPDATE_PIN=v0.4.2
run_updater
expect_status 0 "E10 a pinned update succeeds"
expect_installed v0.4.2 "E10 the pin wins over the latest release"
expect_true "E10 the pin's release was looked up" grep -q '/releases/tags/v0.4.2$' "$CURL_LOG"
run_updater
expect_status 0 "E10 a Pi at its pin exits 0"
expect_output "nothing to do" "E10 a Pi at its pin stays"
expect_installed v0.4.2 "E10 the pin holds"

# ---------------------------------------------------------------------------
# The main flow
# ---------------------------------------------------------------------------

echo
echo "== update =="

setup_case
mkdir -p "$SPLITS_UPDATE_BACKUP_DIR"
for i in 1 2 3 4; do
  echo "old $i" > "$SPLITS_UPDATE_BACKUP_DIR/splits-v0.3.$i-2026010${i}T043000Z.db"
  touch -d "2026-01-0$i 04:30" "$SPLITS_UPDATE_BACKUP_DIR/splits-v0.3.$i-2026010${i}T043000Z.db"
done
echo "wal" > "$DB-wal"
run_updater
expect_status 0 "an update that comes up exits 0"
expect_installed v0.4.2 "current moves to the new release"
expect_true "previous is the version it replaced" test "$(previous)" = v0.4.1
expect_events "stop splits.service;cp splits.db;cp splits.db-wal;start splits.service v0.4.2;" \
  "the service is stopped before the copy and started after"
newest="$(ls -1t "$SPLITS_UPDATE_BACKUP_DIR"/splits-v0.4.1-*.db 2>/dev/null | head -n1)"
expect_true "the DB backup exists" test -n "$newest"
expect_true "the backup is the pre-update DB" cmp -s "$newest" "$DB_ORIG"
expect_true "the -wal is backed up with it" test -f "$newest-wal"
expect_true "three backups are kept" test "$(ls -1 "$SPLITS_UPDATE_BACKUP_DIR"/*.db | wc -l)" -eq 3
expect_true "the oldest backup is pruned" test ! -e "$SPLITS_UPDATE_BACKUP_DIR/splits-v0.3.1-20260101T043000Z.db"
expect_true "old slots are pruned" test "$(slots)" = "v0.4.1 v0.4.2 "
expect_state result updated "the state file says updated"
expect_state state current "the state file says current"
expect_state installed v0.4.2 "the state file names the new version"

# ---------------------------------------------------------------------------
# Rollback, the next night, --clear-block
# ---------------------------------------------------------------------------

echo
echo "== rollback =="

setup_case
echo v0.4.2 > "$SVC/broken"
run_updater
expect_status 1 "a release that does not come up exits 1"
expect_output "rolling back to v0.4.1" "the rollback is announced"
expect_installed v0.4.1 "current is back on the old release"
expect_true "previous is what it was before" test "$(previous)" = v0.4.0
expect_true "the DB is byte-identical to before" cmp -s "$DB" "$DB_ORIG"
expect_true "the failed version's -wal is gone" test ! -e "$DB-wal"
expect_true "the tag is blocked" grep -qxF v0.4.2 "$SPLITS_ROOT/blocked"
expect_true "the failed slot is removed" test ! -e "$SPLITS_ROOT/releases/v0.4.2"
expect_events "stop splits.service;cp splits.db;start splits.service v0.4.2;stop splits.service;cp splits-v0.4.1-$(basename "$(ls "$SPLITS_UPDATE_BACKUP_DIR")" | sed 's/^splits-v0.4.1-//');start splits.service v0.4.1;" \
  "stop, back up, start new, stop, restore, start old"
expect_state result rolled-back "update-state.json says rolled back"
expect_state latest v0.4.2 "update-state.json names the failed tag"
expect_state state stuck "update-state.json says stuck"

run_updater
expect_status 0 "the next run exits 0"
expect_output "is blocked" "the next run refuses the blocked tag"
expect_installed v0.4.1 "the next run stays on the old release"
expect_untouched "the next run does not touch the service"

run_updater --clear-block
expect_status 0 "--clear-block exits 0"
expect_true "--clear-block empties the blocked list" test ! -e "$SPLITS_ROOT/blocked"
expect_state state behind "after --clear-block the Pi is behind again"

: > "$SVC/broken"                                  # the fix was elsewhere (say, a full disk)
run_updater
expect_status 0 "after --clear-block the tag is retried"
expect_installed v0.4.2 "and installed"

setup_case
printf 'v0.4.2\nv0.4.1\n' > "$SVC/broken"         # the old one does not come back either
run_updater
expect_status 1 "a failed rollback still exits 1"
expect_output "CRITICAL" "a failed rollback says CRITICAL"
expect_installed v0.4.1 "a failed rollback still points current at the old release"
expect_state result rollback-failed "update-state.json says the rollback failed"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES case(s) failed"
  exit 1
fi
echo "all cases passed"
