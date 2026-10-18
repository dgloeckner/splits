#!/usr/bin/env bash
#
# updater-version.sh — the tag rules splits-update.sh decides on its own.
#
# The updater answers "is this a release?", "may I install it?" and "which
# of two is newer?" in shell, with nothing else on the Pi to ask. Getting
# the last one wrong is how a Pi moves backwards, or — worse — stops
# moving while reporting it as prudence. This is the one table of cases
# for those rules (ADR-0023 §1, FEAT-0016 stage 3).
#
# Usage: bash deploy/test/updater-version.sh      (exit 0 = all cases pass)

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UPDATER="$HERE/../splits-update.sh"

# Extract the pure functions and evaluate them rather than sourcing the
# script, which would run an update against this machine.
eval "$(sed -n '/^is_release_tag()/,/^}/p;/^is_installable_tag()/,/^}/p;/^compare_tags()/,/^}/p;/^compare_pre_release()/,/^}/p' "$UPDATER")"

FAILURES=0
pass() { printf '[ OK ]  %s\n' "$1"; }
fail() { FAILURES=$((FAILURES + 1)); printf '[FAIL]  %s\n' "$1"; }

assert_tag()     { if is_release_tag "$1"; then pass "release tag: $1"; else fail "expected '$1' to parse as a release tag"; fi; }
assert_not_tag() { if is_release_tag "$1"; then fail "expected '$1' NOT to parse as a release tag"; else pass "not a tag: ${1:-<empty>}"; fi; }
assert_auto()    { if is_installable_tag "$1"; then pass "auto-installed: $1"; else fail "expected '$1' to be auto-installable"; fi; }
assert_no_auto() { if is_installable_tag "$1"; then fail "expected '$1' NOT to be auto-installed"; else pass "never auto-installed: ${1:-<empty>}"; fi; }

assert_order() {
  local a="$1" expected="$2" b="$3" actual
  actual="$(compare_tags "$a" "$b")"
  if [ "$actual" = "$expected" ]; then pass "compare $a $b = $expected"; else fail "compare $a $b = $actual, expected $expected"; fi
}

echo "== what counts as a release tag =="
assert_tag v0.4.1
assert_tag v1.0.10
assert_tag v1.2.0-rc1
assert_tag v1.2.0-rc.1
assert_not_tag 1.1.7          # clubbar shipped this, and every updater refused it
assert_not_tag nightly
assert_not_tag dev
assert_not_tag dev-4f2a9c1
assert_not_tag v0.4.1-3-gabc1234-dirty
assert_not_tag ""
assert_not_tag v1.0
assert_not_tag v1.0.7.1
assert_not_tag latest
# Why the check runs before a tag reaches a path or a URL.
assert_not_tag 'v1.0.7/../../etc'
assert_not_tag 'v1.0.7; rm -rf /'

echo
echo "== what the updater installs on its own =="
assert_auto v0.4.1
assert_auto v1.0.10
assert_no_auto v1.2.0-rc1     # a pre-release: a person installs it, the timer never
assert_no_auto 1.1.7
assert_no_auto nightly        # replaced on every merge, so it names no build
assert_no_auto dev
assert_no_auto ""

echo
echo "== which of two is newer =="
# The case a string comparison gets wrong, and the reason this exists.
assert_order v1.0.10 1 v1.0.9
assert_order v1.0.9 -1 v1.0.10
assert_order v1.0.0 1 v0.9.99
assert_order v1.1.0 1 v1.0.99
assert_order v0.4.2 1 v0.4.1
assert_order v0.4.1 0 v0.4.1
# A leading zero is decimal, not octal: a bare $((08)) aborts the shell.
assert_order v1.0.8 0 v1.0.08
assert_order v1.0.10 0 v1.0.010

echo
echo "== a Pi on a hand-installed pre-release moves to the release =="
assert_order v1.2.0 1 v1.2.0-rc1
assert_order v1.2.0-rc1 -1 v1.2.0
assert_order v1.2.0-rc.9 -1 v1.2.0-rc.10
assert_order v1.2.0-alpha -1 v1.2.0-alpha.1
assert_order v1.2.0-1 -1 v1.2.0-alpha
assert_order v1.0.0-beta.11 -1 v1.0.0-rc.1

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES case(s) failed"
  exit 1
fi
echo "all cases passed"
