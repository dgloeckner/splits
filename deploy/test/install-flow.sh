#!/usr/bin/env bash
#
# install-flow.sh — what `deploy/install.sh` does to a real host.
#
# The installer is about systemd, users, symlinks and file ownership, so it
# is tested against the real thing: a throwaway CI runner (ubuntu-24.04,
# systemd as PID 1) where it runs as root, starts the real backend and asks
# its /api/health which version is serving. Caddy is stubbed (a binary on
# PATH and a unit that sleeps), because the Caddyfile is only rendered, not
# served, here.
#
# Covers FEAT-0016 stage 2 (ADR-0023 §2):
#   - a flat install (plain binary, real web dir, env, DB, Caddyfile) is
#     migrated: links replace the copies, env/DB/Caddyfile survive;
#   - current names the tag, both host links exist, splits-update.timer is
#     enabled and active, and the backend serves that tag;
#   - re-running is idempotent, also from inside the installed slot;
#   - a newer bundle moves current, sets previous and is the one serving.
#
# Usage (needs two bundles from deploy/bundle.sh, older first):
#   sudo SPLITS_INSTALL_TEST=1 bash deploy/test/install-flow.sh \
#     dist/splits-linux-amd64-v0.0.1.tar.gz dist/splits-linux-amd64-v0.0.2.tar.gz
#
# It CHANGES THE HOST (/opt/splits, /etc/splits, /etc/systemd, a `splits`
# user) and refuses to run without SPLITS_INSTALL_TEST=1 on a host that
# has no splits on it yet. Never run it on a machine you care about.

set -uo pipefail

FAILURES=0
pass() { printf '[ OK ]  %s\n' "$1"; }
fail() { FAILURES=$((FAILURES + 1)); printf '[FAIL]  %s\n' "$1"; }
check() { local what="$1"; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }
die() { echo "install-flow: $*" >&2; exit 2; }

[ "${SPLITS_INSTALL_TEST:-}" = 1 ] || die "refusing: this test changes the host; set SPLITS_INSTALL_TEST=1 on a throwaway machine"
[ "$(id -u)" -eq 0 ] || die "must run as root"
[ -d /run/systemd/system ] || die "needs systemd as PID 1"
[ ! -e /opt/splits ] && [ ! -e /etc/splits ] || die "refusing: this host already has a splits install"
[ $# -eq 2 ] || die "usage: $0 <older-bundle.tar.gz> <newer-bundle.tar.gz>"
for t in curl sqlite3 tar; do command -v "$t" >/dev/null || die "needs $t"; done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/splits-install-test.XXXXXX")"
cleanup() {
  case "$WORK" in
    "${TMPDIR:-/tmp}"/splits-install-test.*) rm -rf "$WORK" ;;
    *) echo "refusing to clean up '$WORK'" >&2 ;;
  esac
}
trap cleanup EXIT

unpack() {
  local tarball="$1" dir="$WORK/$2"
  mkdir -p "$dir"
  tar -xzf "$tarball" -C "$dir" || die "cannot extract $tarball"
  # The tarball holds one top-level directory, splits-linux-<arch>-<ver>/.
  find "$dir" -mindepth 1 -maxdepth 1 -type d | head -n1
}

A="$(unpack "$1" a)"
B="$(unpack "$2" b)"
TAG_A="$(head -n1 "$A/VERSION")"
TAG_B="$(head -n1 "$B/VERSION")"
echo "bundles: $TAG_A ($A), $TAG_B ($B)"

export HOSTNAME=splits.example.invalid
export DUCKDNS_TOKEN=00000000-0000-0000-0000-000000000000

# ---------------------------------------------------------------------------
# Caddy stub
# ---------------------------------------------------------------------------
printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/caddy
chmod 0755 /usr/local/bin/caddy
cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=caddy stub for install-flow.sh
[Service]
ExecStart=/bin/sleep infinity
ExecReload=/bin/true
UNIT
systemctl daemon-reload
systemctl start caddy.service

# ---------------------------------------------------------------------------
# A flat install, as the pre-slot install.sh left it
# ---------------------------------------------------------------------------
useradd --system --home /var/lib/splits --shell /usr/sbin/nologin splits
install -d -o splits -g splits -m 0750 /var/lib/splits /var/lib/splits/backups /var/log/splits
install -d -m 0755 /etc/splits /var/www/splits /etc/caddy
install -m 0755 "$A/bin/splits" /usr/local/bin/splits
install -m 0755 "$A/deploy/splits-backup.sh" /usr/local/bin/splits-backup.sh
echo '<!-- flat install -->' > /var/www/splits/index.html
{ sed "s|{{HOSTNAME}}|$HOSTNAME|g" "$A/deploy/splits.env.template"; echo '# operator edit, must survive'; } > /etc/splits/splits.env
chown root:splits /etc/splits/splits.env
chmod 0640 /etc/splits/splits.env
sudo -u splits sqlite3 /var/lib/splits/splits.db "CREATE TABLE household_marker(v TEXT); INSERT INTO household_marker VALUES('keep me');"
sed -e "s|{{HOSTNAME}}|$HOSTNAME|g" -e "s|{{DUCKDNS_TOKEN}}|$DUCKDNS_TOKEN|g" -e "s|{{WEB_ROOT}}|/var/www/splits|g" \
  "$A/deploy/Caddyfile.template" > /etc/caddy/Caddyfile
CADDY_SUM="$(sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)"
ENV_SUM="$(sha256sum /etc/splits/splits.env | cut -d' ' -f1)"

# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------
link_is() { [ -L "$1" ] && [ "$(readlink "$1")" = "$2" ]; }
serving() { curl -fsS --max-time 3 http://127.0.0.1:8080/api/health 2>/dev/null | grep -qF "\"version\":\"$1\""; }
db_marker_kept() { [ "$(sqlite3 /var/lib/splits/splits.db 'SELECT v FROM household_marker')" = 'keep me' ]; }
same_sum() { [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$2" ]; }
slots() { (cd /opt/splits/releases && ls -A | tr '\n' ' '); }

expect_installed() {
  local tag="$1" label="$2"
  check "$label: current -> releases/$tag" link_is /opt/splits/current /opt/splits/releases/"$tag"
  check "$label: /usr/local/bin/splits links into current" link_is /usr/local/bin/splits /opt/splits/current/bin/splits
  check "$label: /var/www/splits links into current" link_is /var/www/splits /opt/splits/current/web/dist
  check "$label: splits-backup.sh links into current" link_is /usr/local/bin/splits-backup.sh /opt/splits/current/deploy/splits-backup.sh
  check "$label: the slot carries ARCH" test -s /opt/splits/releases/"$tag"/ARCH
  check "$label: splits-update.timer enabled" systemctl -q is-enabled splits-update.timer
  check "$label: splits-update.timer active" systemctl -q is-active splits-update.timer
  check "$label: splits-backup.timer active" systemctl -q is-active splits-backup.timer
  check "$label: /api/health reports $tag" serving "$tag"
  check "$label: database kept" db_marker_kept
  check "$label: splits.env untouched" same_sum /etc/splits/splits.env "$ENV_SUM"
  check "$label: Caddyfile unchanged" same_sum /etc/caddy/Caddyfile "$CADDY_SUM"
}

run_install() {
  local label="$1" script="$2"
  if bash "$script" > "$WORK/install.log" 2>&1; then
    pass "$label: install.sh exits 0"
  else
    fail "$label: install.sh exits 0"
    sed 's/^/        /' "$WORK/install.log"
    journalctl -u splits.service -n 30 --no-pager | sed 's/^/        /'
  fi
}

echo
echo "== flat install -> $TAG_A =="
run_install "migrate" "$A/deploy/install.sh"
expect_installed "$TAG_A" "migrate"
check "migrate: no previous after a flat install" test ! -e /opt/splits/previous
check "migrate: the served index.html is the bundle's" sh -c '! grep -q "flat install" /var/www/splits/index.html'

echo
echo "== re-run, same bundle =="
run_install "rerun" "$A/deploy/install.sh"
expect_installed "$TAG_A" "rerun"
check "rerun: still no previous" test ! -e /opt/splits/previous
check "rerun: one slot" test "$(slots)" = "$TAG_A "

echo
echo "== re-run from inside the installed slot =="
run_install "in-slot" /opt/splits/current/deploy/install.sh
expect_installed "$TAG_A" "in-slot"
check "in-slot: one slot" test "$(slots)" = "$TAG_A "

echo
echo "== upgrade $TAG_A -> $TAG_B =="
run_install "upgrade" "$B/deploy/install.sh"
expect_installed "$TAG_B" "upgrade"
check "upgrade: previous -> releases/$TAG_A" link_is /opt/splits/previous /opt/splits/releases/"$TAG_A"
check "upgrade: two slots" test "$(slots)" = "$TAG_A $TAG_B "

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES check(s) failed"
  exit 1
fi
echo "all checks passed"
