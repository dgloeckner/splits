#!/usr/bin/env bash
# Build a single deployable tarball: backend binary + web/dist +
# deploy/ scripts. One artifact to scp; install.sh consumes it.
#
# Usage:
#   TARGET=arm   bash deploy/bundle.sh                  # Pi Zero 2 W (default)
#   TARGET=arm64 VERSION=v0.3.1 bash deploy/bundle.sh   # 64-bit Pi OS, tagged
#   WEB_SKIP=1   bash deploy/bundle.sh                  # reuse existing web/dist
#
# Output:
#   dist/splits-${TARGET}-${VERSION}.tar.gz
#
# Layout inside the tarball:
#   splits-${TARGET}-${VERSION}/
#     bin/splits                   # cross-compiled backend
#     web/dist/                    # PWA shell + assets
#     deploy/install.sh            # idempotent installer
#     deploy/splits.service        # systemd unit
#     deploy/splits-backup.{sh,service,timer}
#     deploy/Caddyfile.template
#     deploy/splits.env.template
#     deploy/README.md
#     VERSION                      # plain text, what's in this bundle
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${TARGET:-arm}"
VERSION="${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"

case "$TARGET" in
  armv6) suffix="linux-armv6" ;;  # Pi Zero / Zero W (BCM2835, ARM11)
  arm)   suffix="linux-armv7" ;;  # Pi Zero 2 W, Pi 3 32-bit
  arm64) suffix="linux-arm64" ;;  # Pi 3/4/5 64-bit
  amd64) suffix="linux-amd64" ;;
  *)
    echo "unknown TARGET: $TARGET (expected armv6|arm|arm64|amd64)" >&2
    exit 1
    ;;
esac

bin="dist/splits-${suffix}"

# 1. Backend (delegates to build.sh; same flags + output path).
echo "==> build backend ($TARGET)"
TARGET="$TARGET" bash deploy/build.sh

# 2. Frontend.
if [ "${WEB_SKIP:-0}" = "1" ]; then
  echo "==> web build skipped (WEB_SKIP=1)"
  if [ ! -d web/dist ] || [ -z "$(ls -A web/dist 2>/dev/null)" ]; then
    echo "WEB_SKIP=1 but web/dist is empty; run 'npm run build' in web/ first" >&2
    exit 1
  fi
else
  echo "==> build web (npm ci + npm run build)"
  (cd web && npm ci && npm run build)
fi

# 3. Stage into temp tree, then tar.
name="splits-${TARGET}-${VERSION}"
out="dist/${name}.tar.gz"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

root="$stage/$name"
install -d "$root/bin" "$root/web" "$root/deploy"
install -m 0755 "$bin" "$root/bin/splits"
cp -R web/dist "$root/web/dist"

# Ship every file in deploy/ except this script + build.sh (build
# artifacts of the workstation, not needed on the target).
for f in deploy/*; do
  base="$(basename "$f")"
  case "$base" in
    bundle.sh|build.sh) continue ;;
  esac
  cp "$f" "$root/deploy/$base"
done
chmod 0755 "$root/deploy/install.sh" "$root/deploy/splits-backup.sh"

printf '%s\n' "$VERSION" > "$root/VERSION"

mkdir -p dist
tar -C "$stage" -czf "$out" "$name"

size="$(ls -lh "$out" | awk '{print $5}')"
echo
echo "==> $out  ($size)"
echo "    target=$TARGET  version=$VERSION"
