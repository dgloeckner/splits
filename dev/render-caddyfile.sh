#!/usr/bin/env bash
# Render dev/Caddyfile.template into the git-ignored dev/Caddyfile.
#
# Usage:
#   HOSTNAME=homeergo.duckdns.org \
#   DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
#   [WEB_ROOT=/path/to/web/dist] \
#   bash dev/render-caddyfile.sh
#
# WEB_ROOT defaults to ../web/dist relative to the rendered file, resolved
# to an absolute path here: Caddy resolves a relative `root` against its
# working directory, not against the Caddyfile. The absolute path only ever
# lands in the git-ignored output.
set -euo pipefail

die() { echo "render-caddyfile: $*" >&2; exit 1; }
# Read from the environment, not the shell: bash sets HOSTNAME to the
# machine's own name, so a forgotten HOSTNAME would otherwise render the
# laptop's hostname instead of failing.
require() { [ -n "$(printenv "$1")" ] || die "$1 is required"; }

require HOSTNAME
require DUCKDNS_TOKEN
HOSTNAME="$(printenv HOSTNAME)"

DEV="$(cd "$(dirname "$0")" && pwd -P)"
TEMPLATE="$DEV/Caddyfile.template"
OUT="$DEV/Caddyfile"

if [ -z "${WEB_ROOT:-}" ]; then
  [ -d "$DEV/../web/dist" ] || die "web/dist missing — run 'npm run build' in web/ first, or set WEB_ROOT"
  WEB_ROOT="$(cd "$DEV/../web/dist" && pwd -P)"
fi

# The rendered file carries the token: owner-only.
umask 077
sed -e "s|{{HOSTNAME}}|$HOSTNAME|g" \
    -e "s|{{DUCKDNS_TOKEN}}|$DUCKDNS_TOKEN|g" \
    -e "s|{{WEB_ROOT}}|$WEB_ROOT|g" \
    "$TEMPLATE" > "$OUT.new"

if grep -n '{{[A-Z_]*}}' "$OUT.new" >&2; then
  rm -f "$OUT.new"
  die "unrendered placeholder left in $TEMPLATE"
fi
mv -f "$OUT.new" "$OUT"
echo "wrote $OUT"
