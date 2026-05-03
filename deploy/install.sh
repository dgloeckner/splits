#!/usr/bin/env bash
# Idempotent installer for splits on a Pi (or any systemd Linux host).
#
# Usage (from a workstation with the binary built and the repo cloned
# on the target host):
#   sudo HOSTNAME=splits.duckdns.org \
#        DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
#        BIN=./dist/splits-linux-armv7 \
#        WEB_DIST=./web/dist \
#        bash deploy/install.sh
#
# Re-running upgrades the binary + Caddyfile in place; the env file and
# the SQLite DB are left untouched after first install.
set -euo pipefail

require() {
  if [ -z "${!1:-}" ]; then echo "missing env: $1" >&2; exit 1; fi
}
require HOSTNAME
require DUCKDNS_TOKEN
require BIN
require WEB_DIST

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root" >&2; exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# 1. User + dirs.
id splits >/dev/null 2>&1 || useradd --system --home /var/lib/splits --shell /usr/sbin/nologin splits
usermod -a -G dialout splits
install -d -o splits -g splits -m 0750 /var/lib/splits /var/lib/splits/backups /var/log/splits
install -d -o root    -g root    -m 0755 /etc/splits /var/log/caddy
install -d -o root    -g root    -m 0755 /var/www/splits

# 2. Binary + helper scripts.
install -o root -g root -m 0755 "$BIN" /usr/local/bin/splits
install -o root -g root -m 0755 "$REPO_DIR/deploy/splits-backup.sh" /usr/local/bin/splits-backup.sh

# 3. Web dist (PWA static).
rsync -a --delete "$WEB_DIST"/ /var/www/splits/

# 4. Env file (only on first install — preserve operator edits).
if [ ! -f /etc/splits/splits.env ]; then
  sed "s|{{HOSTNAME}}|$HOSTNAME|g" \
    "$REPO_DIR/deploy/splits.env.template" > /etc/splits/splits.env
  chown root:splits /etc/splits/splits.env
  chmod 0640 /etc/splits/splits.env
fi

# 5. systemd units.
install -o root -g root -m 0644 "$REPO_DIR/deploy/splits.service"        /etc/systemd/system/splits.service
install -o root -g root -m 0644 "$REPO_DIR/deploy/splits-backup.service" /etc/systemd/system/splits-backup.service
install -o root -g root -m 0644 "$REPO_DIR/deploy/splits-backup.timer"   /etc/systemd/system/splits-backup.timer

# 5b. Optional hardware profile drop-in (e.g. PROFILE=pi-zero).
if [ -n "${PROFILE:-}" ]; then
  override="$REPO_DIR/deploy/profiles/$PROFILE/override.conf"
  if [ ! -f "$override" ]; then
    echo "PROFILE=$PROFILE: no $override" >&2; exit 1
  fi
  install -d -o root -g root -m 0755 /etc/systemd/system/splits.service.d
  install -o root -g root -m 0644 "$override" \
    "/etc/systemd/system/splits.service.d/$PROFILE.conf"
  echo "applied profile: $PROFILE"
fi

# 6. Caddyfile.
sed -e "s|{{HOSTNAME}}|$HOSTNAME|g" \
    -e "s|{{DUCKDNS_TOKEN}}|$DUCKDNS_TOKEN|g" \
    -e "s|{{WEB_ROOT}}|/var/www/splits|g" \
    "$REPO_DIR/deploy/Caddyfile.template" > /etc/caddy/Caddyfile
chown root:caddy /etc/caddy/Caddyfile 2>/dev/null || chown root:root /etc/caddy/Caddyfile
chmod 0640 /etc/caddy/Caddyfile

# 7. Reload + start.
systemctl daemon-reload
systemctl enable --now splits.service
systemctl enable --now splits-backup.timer
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo
echo "splits installed."
echo "  binary    : /usr/local/bin/splits"
echo "  data      : /var/lib/splits/"
echo "  backups   : /var/lib/splits/backups/  (daily 03:30, kept 14d)"
echo "  env       : /etc/splits/splits.env    (preserved on upgrade)"
echo "  caddy log : /var/log/caddy/splits.log"
echo "  status    : systemctl status splits.service"
