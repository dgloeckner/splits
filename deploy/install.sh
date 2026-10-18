#!/usr/bin/env bash
# Idempotent installer for splits on a Pi (or any systemd Linux host).
#
# Installs *the bundle it sits in* — an extracted
# splits-linux-<arch>-<version>.tar.gz from a GitHub Release or from
# deploy/bundle.sh — as an A/B release slot (ADR-0023 §2):
#
#   /opt/splits/releases/<version>/   bin/ web/dist/ deploy/ VERSION ARCH
#   /opt/splits/current  -> releases/<version>
#   /opt/splits/previous -> the slot that was current before
#   /usr/local/bin/splits -> /opt/splits/current/bin/splits
#   /var/www/splits       -> /opt/splits/current/web/dist
#
# Usage, from inside the extracted bundle:
#   sudo HOSTNAME=homeergo.duckdns.org \
#        DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
#        [PROFILE=pi-zero] \
#        bash deploy/install.sh
#
# Re-running is safe: it reinstalls the slot, re-renders the Caddyfile and
# restarts the service. The env file and the SQLite DB are left untouched
# after the first install. An existing flat install (a plain binary at
# /usr/local/bin/splits, a real directory at /var/www/splits) is migrated
# to the slot layout.
#
# A bundle whose VERSION is a release tag (vX.Y.Z) is handed to the
# nightly updater (splits-update.timer); anything else — dev, nightly, a
# `git describe` string — is a hand-managed install the updater leaves
# alone.
set -euo pipefail

ROOT=/opt/splits
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
PREVIOUS="$ROOT/previous"
BIN_LINK=/usr/local/bin/splits
WEB_LINK=/var/www/splits
ENV_FILE=/etc/splits/splits.env

die() { echo "install.sh: $*" >&2; exit 1; }

require() {
  if [ -z "${!1:-}" ]; then die "missing env: $1"; fi
}

if [ -n "${BIN:-}" ] || [ -n "${WEB_DIST:-}" ]; then
  die "BIN= and WEB_DIST= are gone: install.sh installs the bundle it sits in. Build one with
  TARGET=arm bash deploy/bundle.sh
and run deploy/install.sh from inside the extracted tarball (see deploy/README.md)."
fi
require HOSTNAME
require DUCKDNS_TOKEN

if [ "$(id -u)" -ne 0 ]; then
  die "must run as root"
fi

BUNDLE="$(cd "$(dirname "$0")/.." && pwd -P)"

[ -x "$BUNDLE/bin/splits" ] || die "$BUNDLE/bin/splits missing — run install.sh from an extracted bundle (deploy/bundle.sh)"
[ -f "$BUNDLE/web/dist/index.html" ] || die "$BUNDLE/web/dist/index.html missing — not a complete bundle"
[ -f "$BUNDLE/VERSION" ] || die "$BUNDLE/VERSION missing — not a bundle from deploy/bundle.sh"

TAG="$(head -n1 "$BUNDLE/VERSION" | tr -d '[:space:]')"
# The slot is named after VERSION line 1, so it must be one safe path
# component — a release tag, or a dev/nightly/describe string.
case "$TAG" in
  ''|.|..|*/*) die "VERSION line 1 '$TAG' cannot name a release slot" ;;
esac
[[ "$TAG" =~ ^[0-9A-Za-z._+-]+$ ]] || die "VERSION line 1 '$TAG' cannot name a release slot"
if [ ! -f "$BUNDLE/ARCH" ]; then
  echo "install.sh: WARNING: bundle has no ARCH file; the updater will refuse this slot" >&2
fi

# Caddy must already be installed (with the duckdns DNS plugin — see
# deploy/README.md). The installer writes /etc/caddy/Caddyfile and
# reloads the service; both fail without a Caddy binary on PATH.
if ! command -v caddy >/dev/null 2>&1; then
  cat >&2 <<'ERR'
caddy not found on PATH.

Install Caddy with the DuckDNS DNS plugin first, e.g.

  # one-time host prep (Debian/Raspberry Pi OS)
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update && sudo apt-get install -y caddy

  # then build a custom caddy with the duckdns plugin
  sudo apt-get install -y golang
  go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
  ~/go/bin/xcaddy build --with github.com/caddy-dns/duckdns
  sudo install -m 0755 ./caddy /usr/bin/caddy

Then re-run this installer.
ERR
  exit 1
fi
install -d -o root -g root -m 0755 /etc/caddy

# `ln -sfn` writes the new link beside the old one and `mv -T` renames it
# over the top: one rename(2), so a reader sees the old target or the new
# one, never a missing link.
swap_link() {
  local target="$1" link="$2"
  ln -sfn "$target" "$link.new" && mv -Tf "$link.new" "$link"
}

# 1. User + dirs.
id splits >/dev/null 2>&1 || useradd --system --home /var/lib/splits --shell /usr/sbin/nologin splits
usermod -a -G dialout splits
install -d -o splits -g splits -m 0750 /var/lib/splits /var/lib/splits/backups /var/log/splits
install -d -o root    -g root    -m 0755 /etc/splits "$ROOT" "$RELEASES" /var/www

# /var/log/caddy must be writable by the caddy daemon. Fall back to
# root:root if the caddy user/group hasn't been created yet — install
# rechowns once Caddy is installed.
if id caddy >/dev/null 2>&1; then
  install -d -o caddy -g caddy -m 0755 /var/log/caddy
else
  install -d -o root  -g root  -m 0755 /var/log/caddy
fi

# 2. The release slot. Staged under a dot-name and renamed into place, so
#    a power loss never leaves a half-copied directory named after a tag.
SLOT="$RELEASES/$TAG"
OLD="$(readlink -f "$CURRENT" 2>/dev/null || true)"
if [ "$BUNDLE" = "$(readlink -f "$SLOT" 2>/dev/null || true)" ]; then
  echo "re-installing from the installed slot $SLOT"
else
  stage="$RELEASES/.incoming-$TAG"
  rm -rf "$stage"
  install -d -o root -g root -m 0755 "$stage"
  cp -R "$BUNDLE/bin" "$BUNDLE/web" "$BUNDLE/deploy" "$BUNDLE/VERSION" "$stage/"
  [ -f "$BUNDLE/ARCH" ] && cp "$BUNDLE/ARCH" "$stage/"
  chown -R root:root "$stage"
  chmod -R u+rwX,go+rX,go-w "$stage"
  chmod 0755 "$stage/bin/splits" "$stage"/deploy/*.sh
  # Replacing a slot that is running: the old directory is renamed away
  # first, the live process keeps its open inodes.
  if [ -e "$SLOT" ]; then
    rm -rf "$RELEASES/.replaced-$TAG"
    mv "$SLOT" "$RELEASES/.replaced-$TAG"
  fi
  mv "$stage" "$SLOT"
  rm -rf "$RELEASES/.replaced-$TAG"
fi

# 3. current / previous.
if [ -n "$OLD" ] && [ -d "$OLD" ] && [ "$OLD" != "$SLOT" ]; then
  swap_link "$OLD" "$PREVIOUS"
fi
swap_link "$SLOT" "$CURRENT"

# 4. Host links into current. A flat install's plain binary or real web
#    directory is replaced by the link (the copy is the old version, which
#    the slot supersedes).
if [ -e "$BIN_LINK" ] && [ ! -L "$BIN_LINK" ]; then
  echo "migrating flat install: replacing $BIN_LINK with a link into $CURRENT"
  rm -f "$BIN_LINK"
fi
swap_link "$CURRENT/bin/splits" "$BIN_LINK"

if [ -d "$WEB_LINK" ] && [ ! -L "$WEB_LINK" ]; then
  echo "migrating flat install: replacing the directory $WEB_LINK with a link into $CURRENT"
  rm -rf "$WEB_LINK"
fi
swap_link "$CURRENT/web/dist" "$WEB_LINK"

# The backup script follows the installed release too.
if [ -e /usr/local/bin/splits-backup.sh ] && [ ! -L /usr/local/bin/splits-backup.sh ]; then
  rm -f /usr/local/bin/splits-backup.sh
fi
swap_link "$CURRENT/deploy/splits-backup.sh" /usr/local/bin/splits-backup.sh

# 5. Old slots: keep current and previous, drop the rest and any
#    leftover staging directories.
keep_prev="$(readlink -f "$PREVIOUS" 2>/dev/null || true)"
for slot in "$RELEASES"/* "$RELEASES"/.incoming-* "$RELEASES"/.replaced-*; do
  [ -d "$slot" ] || continue
  [ "$slot" = "$SLOT" ] && continue
  [ "$slot" = "$keep_prev" ] && continue
  rm -rf "$slot"
done

# 6. Env file (only on first install — preserve operator edits).
if [ ! -f "$ENV_FILE" ]; then
  sed "s|{{HOSTNAME}}|$HOSTNAME|g" \
    "$SLOT/deploy/splits.env.template" > "$ENV_FILE"
  chown root:splits "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi

# 7. systemd units. The updater units run the updater of whatever release
#    is current, so each release brings its own.
for unit in splits.service splits-backup.service splits-backup.timer \
            splits-update.service splits-update.timer; do
  install -o root -g root -m 0644 "$SLOT/deploy/$unit" "/etc/systemd/system/$unit"
done

# 7b. Optional hardware profile drop-in (e.g. PROFILE=pi-zero).
if [ -n "${PROFILE:-}" ]; then
  override="$SLOT/deploy/profiles/$PROFILE/override.conf"
  if [ ! -f "$override" ]; then
    die "PROFILE=$PROFILE: no $override"
  fi
  install -d -o root -g root -m 0755 /etc/systemd/system/splits.service.d
  install -o root -g root -m 0644 "$override" \
    "/etc/systemd/system/splits.service.d/$PROFILE.conf"
  echo "applied profile: $PROFILE"
fi

# 8. Caddyfile.
sed -e "s|{{HOSTNAME}}|$HOSTNAME|g" \
    -e "s|{{DUCKDNS_TOKEN}}|$DUCKDNS_TOKEN|g" \
    -e "s|{{WEB_ROOT}}|$WEB_LINK|g" \
    "$SLOT/deploy/Caddyfile.template" > /etc/caddy/Caddyfile
chown root:caddy /etc/caddy/Caddyfile 2>/dev/null || chown root:root /etc/caddy/Caddyfile
chmod 0640 /etc/caddy/Caddyfile

# 9. Reload + (re)start. `restart`, not `enable --now`: on an upgrade the
#    old process would otherwise keep serving.
systemctl daemon-reload
systemctl enable splits.service
systemctl restart splits.service
systemctl enable --now splits-backup.timer
systemctl enable --now splits-update.timer
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# 10. Health: the slot is installed once /api/health reports its version.
addr="$(sed -n 's/^SPLITS_ADDR=//p' "$ENV_FILE" | tail -n1)"
addr="${addr:-127.0.0.1:8080}"
case "$addr" in :*) addr="127.0.0.1$addr" ;; esac
healthy=0
for _ in $(seq 1 "${INSTALL_HEALTH_TIMEOUT:-60}"); do
  body="$(curl -fsS --max-time 2 "http://$addr/api/health" 2>/dev/null || true)"
  if [[ "$body" == *"\"version\":\"$TAG\""* ]]; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  updates="nightly at 04:30 (splits-update.timer)"
else
  updates="off — '$TAG' is not a release tag, this is a hand-managed install"
fi

echo
echo "splits $TAG installed."
echo "  slot      : $SLOT"
echo "  current   : $CURRENT -> $(readlink "$CURRENT")"
echo "  previous  : $(readlink "$PREVIOUS" 2>/dev/null || echo '(none)')"
echo "  binary    : $BIN_LINK -> $(readlink "$BIN_LINK")"
echo "  web root  : $WEB_LINK -> $(readlink "$WEB_LINK")"
echo "  data      : /var/lib/splits/"
echo "  backups   : /var/lib/splits/backups/  (daily 03:30, kept 14d)"
echo "  env       : $ENV_FILE    (preserved on upgrade)"
echo "  updates   : $updates"
echo "  caddy log : /var/log/caddy/splits.log"
echo "  status    : systemctl status splits.service"

if [ "$healthy" != 1 ]; then
  echo >&2
  echo "install.sh: WARNING: /api/health on $addr did not report $TAG within ${INSTALL_HEALTH_TIMEOUT:-60}s." >&2
  echo "install.sh: check 'journalctl -u splits -n 50'." >&2
  exit 1
fi
echo "  health    : http://$addr/api/health reports $TAG"
