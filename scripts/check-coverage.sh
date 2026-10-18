#!/usr/bin/env bash
# Enforce the backend statement-coverage floor.
#
#   scripts/check-coverage.sh backend/.coverage-floor backend/coverage.out
#
# The floor never goes down. The PR that raises coverage raises the floor
# (ADR-0022). Prints the per-package breakdown for information and fails
# only on the total.
set -euo pipefail

floor_file="${1:?usage: check-coverage.sh FLOOR_FILE PROFILE}"
profile="${2:?usage: check-coverage.sh FLOOR_FILE PROFILE}"

floor="$(tr -d '[:space:]' < "$floor_file")"
# `go tool cover -func` resolves package paths, so run it inside the module.
func_out="$(cd "$(dirname "$profile")" && go tool cover -func="$(basename "$profile")")"

echo "coverage by package:"
echo "$func_out" | grep -v '^total:' | awk '
  { n=$NF; sub("%","",n); split($1,a,":"); p=a[1]; sub(/\/[^\/]*$/,"",p); sum[p]+=n; cnt[p]++ }
  END { for (p in sum) printf "  %-60s %5.1f%%\n", p, sum[p]/cnt[p] }' | sort

total="$(echo "$func_out" | awk '/^total:/ { n=$NF; sub("%","",n); print n }')"
echo
echo "total: ${total}%  floor: ${floor}%"
if awk -v t="$total" -v f="$floor" 'BEGIN { exit !(t+0 < f+0) }'; then
  echo "coverage ${total}% is below the floor ${floor}% (backend/.coverage-floor)" >&2
  exit 1
fi
