#!/usr/bin/env bash
# Run what the CI `web` and `backend` jobs run (.github/workflows/ci.yml),
# locally, in one command. The e2e job is not included; see AGENTS.md
# "Cloud sessions" for the Playwright subsets.
#
#   scripts/check.sh            # both jobs
#   scripts/check.sh --web      # web only: lockfile, lint, typecheck, vitest + coverage, build
#   scripts/check.sh --backend  # backend only: vet, staticcheck, test -race + coverage floor
#
# Every step runs even after one fails, so a single run shows every problem;
# the exit code is non-zero if any step failed. Lint is blocking, as in CI.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

do_web=1
do_backend=1
for arg in "$@"; do
  case "$arg" in
    --web)     do_backend=0 ;;
    --backend) do_web=0 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "check.sh: unknown option '$arg'" >&2; exit 2 ;;
  esac
done
if [ "$do_web" = 0 ] && [ "$do_backend" = 0 ]; then
  echo "check.sh: --web and --backend are exclusive; pass neither to run both" >&2
  exit 2
fi

failed=()
passed=()
step() {
  local name="$1"; shift
  echo
  echo "=== $name"
  local t0=$SECONDS
  if "$@"; then
    passed+=("$name ($((SECONDS - t0))s)")
  else
    failed+=("$name")
  fi
}

if [ "$do_web" = 1 ]; then
  cd "$ROOT/web"
  # CI always runs `npm ci`; locally only when node_modules is missing or
  # older than the lockfile, which is what makes a re-run cheap.
  if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    step "web: npm ci" npm ci --no-audit --no-fund --loglevel=error
  fi
  step "web: package-lock.json unchanged" git diff --exit-code -- package-lock.json
  step "web: lint" npm run --silent lint
  step "web: typecheck" npm run --silent typecheck
  step "web: vitest + coverage" npm run --silent test:coverage
  step "web: build" npm run --silent build
fi

if [ "$do_backend" = 1 ]; then
  # backend.sh carries the staticcheck pin and the coverage command, so CI
  # and this script cannot drift apart on either.
  step "backend: vet + staticcheck" bash "$ROOT/scripts/backend.sh" lint
  step "backend: test -race + coverage floor" bash "$ROOT/scripts/backend.sh" coverage
fi

echo
echo "=== summary"
for p in "${passed[@]}"; do echo "  ok    $p"; done
for f in "${failed[@]}"; do echo "  FAIL  $f"; done
[ ${#failed[@]} -eq 0 ]
