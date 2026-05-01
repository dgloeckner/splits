#!/usr/bin/env bash
# Cross-compile the splits backend for Raspberry Pi.
#
# Default target: linux/arm/v7 (Pi Zero 2 W with 32-bit Pi OS, the
# documented hardware in ADR-0001). Override with TARGET=arm64 for
# 64-bit Pi OS or TARGET=amd64 for x86 hosts (NAS/Docker).
#
# Output: dist/splits-${OS}-${ARCH}{ -armv7} so multiple builds coexist.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${TARGET:-arm}"

case "$TARGET" in
  arm)
    GOOS=linux GOARCH=arm GOARM=7
    suffix="linux-armv7"
    ;;
  arm64)
    GOOS=linux GOARCH=arm64
    suffix="linux-arm64"
    ;;
  amd64)
    GOOS=linux GOARCH=amd64
    suffix="linux-amd64"
    ;;
  *)
    echo "unknown TARGET: $TARGET (expected arm|arm64|amd64)" >&2
    exit 1
    ;;
esac

mkdir -p dist
out="dist/splits-${suffix}"

cd backend
echo "Building → $out (GOOS=$GOOS GOARCH=$GOARCH${GOARM:+ GOARM=$GOARM})"
env GOOS="$GOOS" GOARCH="$GOARCH" ${GOARM:+GOARM="$GOARM"} CGO_ENABLED=0 \
  go build -trimpath -ldflags="-s -w" -o "../$out" ./cmd/splits
cd ..

echo "$(ls -lh "$out" | awk '{print $5}')  $out"
