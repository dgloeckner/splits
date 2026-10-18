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
  # Same run as CI: race + atomic coverage profile, then the floor check
  # (backend/.coverage-floor, never lowered; raise it with the PR that
  # earns it).
  coverage)
    go test -race -covermode=atomic -coverprofile=coverage.out ./...
    bash ../scripts/check-coverage.sh .coverage-floor coverage.out
    ;;
  vet)         go vet ./... ;;
  fmt)    go fmt ./... ;;
  run)    go run ./cmd/splits ;;
  lint)
    go vet ./...
    # Pinned to the newest release that supports the go.mod toolchain
    # (v0.8.x needs Go 1.26). Keep in sync with .github/workflows/ci.yml.
    go run honnef.co/go/tools/cmd/staticcheck@v0.7.0 ./...
    ;;
  clean)  rm -f splits splits.exe coverage.out coverage.html ;;
  help|*) echo "usage: scripts/backend.sh {build|test|test-norace|coverage|vet|fmt|run|lint|clean}" ;;
esac
