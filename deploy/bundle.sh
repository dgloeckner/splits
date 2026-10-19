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
#   dist/splits-linux-${ARCH}-${VERSION}.tar.gz   (e.g. splits-linux-armv7-v0.4.0.tar.gz)
#
# Layout inside the tarball:
#   splits-linux-${ARCH}-${VERSION}/
#     bin/splits                   # cross-compiled backend
#     web/dist/                    # PWA shell + assets
#     deploy/install.sh            # idempotent installer
#     deploy/splits.service        # systemd unit
#     deploy/splits-backup.{sh,service,timer}
#     deploy/Caddyfile.template
#     deploy/splits.env.template
#     deploy/README.md
#     VERSION                      # line 1: version, line 2: git commit (if known)
#     ARCH                         # linux-armv6|linux-armv7|linux-arm64|linux-amd64
#
# The binary and the PWA are stamped with the same VERSION (ADR-0023 §1);
# the updater picks its asset by ARCH and never reads VERSION — the
# installed slot's name is the only record of what is installed.
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

COMMIT="$(git rev-parse --short=7 HEAD 2>/dev/null || echo unknown)"

# 1. Backend (delegates to build.sh; same flags + output path).
echo "==> build backend ($TARGET)"
TARGET="$TARGET" VERSION="$VERSION" COMMIT="$COMMIT" bash deploy/build.sh

# 2. Frontend.
if [ "${WEB_SKIP:-0}" = "1" ]; then
  echo "==> web build skipped (WEB_SKIP=1)"
  if [ ! -d web/dist ] || [ -z "$(ls -A web/dist 2>/dev/null)" ]; then
    echo "WEB_SKIP=1 but web/dist is empty; run 'npm run build' in web/ first" >&2
    exit 1
  fi
else
  echo "==> build web (npm ci + npm run build)"
  (cd web && npm ci && VERSION="$VERSION" npm run build)
fi

# 3. Stage into temp tree, then tar.
# Same linux-<arch> suffix as the binary, so release assets are unambiguous.
name="splits-${suffix}-${VERSION}"
out="dist/${name}.tar.gz"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

root="$stage/$name"
install -d "$root/bin" "$root/web" "$root/deploy"
install -m 0755 "$bin" "$root/bin/splits"
cp -R web/dist "$root/web/dist"

# Ship every file in deploy/ except this script + build.sh (build
# artifacts of the workstation, not needed on the target) and the test
# suites under deploy/test/.
for f in deploy/*; do
  base="$(basename "$f")"
  case "$base" in
    bundle.sh|build.sh|test) continue ;;
  esac
  cp -R "$f" "$root/deploy/$base"
done
chmod 0755 "$root/deploy/install.sh" "$root/deploy/splits-backup.sh" "$root/deploy/splits-update.sh"

printf '%s\n' "$VERSION" > "$root/VERSION"
# Second line: the exact commit, so a "nightly" bundle still says what it is.
if sha="$(git rev-parse HEAD 2>/dev/null)"; then
  printf '%s\n' "$sha" >> "$root/VERSION"
fi
printf '%s\n' "$suffix" > "$root/ARCH"

mkdir -p dist
tar -C "$stage" -czf "$out" "$name"

size="$(ls -lh "$out" | awk '{print $5}')"
echo
echo "==> $out  ($size)"
echo "    target=$TARGET  version=$VERSION"
