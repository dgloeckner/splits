#!/usr/bin/env bash
# Thin wrappers around `go` for the splits backend. Replaces the
# previous Makefile (no make in this project).
set -euo pipefail
cd "$(dirname "$0")/../backend"

cmd="${1:-help}"
case "$cmd" in
  build)  go build -o splits ./cmd/splits ;;
  # -race is on by default: backend suite finishes in ~15 s with the
  # detector and has caught real concurrency bugs (sessionizer cache vs
  # janitor sweep). Use `test-norace` for timing comparisons or
  # platforms without -race support.
  test)        go test -race ./... ;;
  test-norace) go test ./... ;;
  vet)         go vet ./... ;;
  fmt)    go fmt ./... ;;
  run)    go run ./cmd/splits ;;
  lint)
    go vet ./...
    if ! command -v staticcheck >/dev/null; then
      go install honnef.co/go/tools/cmd/staticcheck@latest
    fi
    staticcheck ./...
    ;;
  clean)  rm -f splits splits.exe coverage.out coverage.html ;;
  help|*) echo "usage: scripts/backend.sh {build|test|test-norace|vet|fmt|run|lint|clean}" ;;
esac
