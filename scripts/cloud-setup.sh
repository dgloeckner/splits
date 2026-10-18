#!/usr/bin/env bash
# Bring a Claude Code cloud session to the point where scripts/check.sh and
# the Playwright suite run with no manual steps (issue #25).
#
#   scripts/cloud-setup.sh            # what the SessionStart hook runs
#   scripts/cloud-setup.sh --force    # run off the cloud too (the environment
#                                     # setup script, or a deliberate local run)
#
# Two callers, one script:
#   - The environment setup script (pasted into the cloud environment settings,
#     see AGENTS.md "Cloud sessions") runs it once per environment image, so
#     the expensive downloads land in the environment cache.
#   - The SessionStart hook in .claude/settings.json runs it on every start
#     and resume. With a warm cache every step finds its work done and only
#     the verify pass costs anything (a few seconds). Without one, the hook
#     installs what is missing, so a session still ends up ready, just slower.
#
# Contract:
#   - A no-op unless CLAUDE_CODE_REMOTE=true or --force. The hook lives in the
#     shared settings.json, so it also fires on developer laptops, where it
#     must never touch /usr/local or apt.
#   - Every step is idempotent and skipped when already done.
#   - Always exits 0. A failed download must not block the session from
#     starting; the verify pass reports what is missing instead.
#
# Log: logs/cloud-setup.log (gitignored).
#
# Deliberately no `set -e`: every failure has to fall through to `exit 0`.
set -uo pipefail

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "cloud-setup: unknown option '$arg'" >&2; exit 0 ;;
  esac
done

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && [ "$FORCE" != 1 ]; then
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/logs" 2>/dev/null
LOG="$ROOT/logs/cloud-setup.log"
# Everything goes to the log; the hook's stdout gets the same lines.
exec > >(tee -a "$LOG") 2>&1

log() { echo "[cloud-setup] $*"; }
log "---- $(date -u +%Y-%m-%dT%H:%M:%SZ) start"

SUDO=""
[ "$(id -u)" != 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"

apt_updated=0
apt_install() {
  if [ "$apt_updated" = 0 ]; then
    $SUDO apt-get update -qq >/dev/null 2>&1 || true
    apt_updated=1
  fi
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq --no-install-recommends "$@" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Go at exactly the go.mod version
# ---------------------------------------------------------------------------
# The image ships an older Go (1.24.7 at the time of writing) while go.mod asks
# for 1.25.x, so every fresh session paid a GOTOOLCHAIN auto-download on its
# first `go` call. Fetch the toolchain the same way GOTOOLCHAIN would (through
# proxy.golang.org, checked against sum.golang.org), copy it out of the module
# cache so `go clean -modcache` cannot pull GOROOT from under us, and point
# /usr/local/go at it. Nothing else on PATH changes.
want_go="$(awk '/^go [0-9]/ { print $2; exit }' "$ROOT/backend/go.mod")"
have_go="$(GOTOOLCHAIN=local go env GOVERSION 2>/dev/null || true)"
if [ -z "$want_go" ]; then
  log "WARN: no go directive in backend/go.mod"
elif [ "$have_go" = "go$want_go" ]; then
  log "go: $have_go already installed"
elif ! command -v go >/dev/null 2>&1; then
  log "WARN: no go on PATH to bootstrap go$want_go from"
else
  log "go: have ${have_go:-none}, installing go$want_go"
  src="$(GOTOOLCHAIN="go$want_go" go env GOROOT 2>/dev/null || true)"
  dest="/usr/local/go$want_go"
  if [ -n "$src" ] && [ -x "$src/bin/go" ]; then
    if [ ! -x "$dest/bin/go" ]; then
      $SUDO cp -a "$src" "$dest.tmp" && $SUDO chmod -R u+w "$dest.tmp" && $SUDO mv "$dest.tmp" "$dest"
    fi
    # /usr/local/go is a symlink to the versioned directory in the image. If it
    # is a real directory somewhere else, keep it rather than deleting it.
    if [ -d /usr/local/go ] && [ ! -L /usr/local/go ]; then
      $SUDO mv /usr/local/go "/usr/local/go.orig.$(date +%s)"
    fi
    $SUDO ln -sfn "$dest" /usr/local/go
    hash -r
    log "go: now $(GOTOOLCHAIN=local go env GOVERSION 2>/dev/null)"
  else
    log "WARN: could not fetch go$want_go (check egress to proxy.golang.org)"
  fi
fi

# ---------------------------------------------------------------------------
# staticcheck, as a binary, at the pin scripts/backend.sh and ci.yml use
# ---------------------------------------------------------------------------
want_sc="$(sed -n 's/^STATICCHECK_VERSION=//p' "$ROOT/scripts/backend.sh")"
if [ -z "$want_sc" ]; then
  log "WARN: STATICCHECK_VERSION not found in scripts/backend.sh"
elif staticcheck -version 2>/dev/null | grep -qF "($want_sc)"; then
  log "staticcheck: $want_sc already installed"
else
  log "staticcheck: installing $want_sc"
  if $SUDO env "PATH=$PATH" GOTOOLCHAIN=local GOBIN=/usr/local/bin \
      go install "honnef.co/go/tools/cmd/staticcheck@$want_sc"; then
    log "staticcheck: $(staticcheck -version 2>/dev/null)"
  else
    log "WARN: staticcheck install failed"
  fi
fi

# ---------------------------------------------------------------------------
# Warm Go module cache
# ---------------------------------------------------------------------------
( cd "$ROOT/backend" && GOTOOLCHAIN=local go mod download ) || log "WARN: go mod download failed"

# ---------------------------------------------------------------------------
# sqlite3 CLI: the e2e seed helpers shell out to it
# ---------------------------------------------------------------------------
if command -v sqlite3 >/dev/null 2>&1; then
  log "sqlite3: present"
else
  log "sqlite3: installing"
  apt_install sqlite3 || log "WARN: apt-get install sqlite3 failed"
fi

# ---------------------------------------------------------------------------
# web/node_modules, re-installed only when the lockfile changes
# ---------------------------------------------------------------------------
lock="$ROOT/web/package-lock.json"
stamp="$ROOT/web/node_modules/.cloud-setup-lock.sha256"
lock_sum="$(sha256sum "$lock" | cut -d' ' -f1)"
if [ -d "$ROOT/web/node_modules" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$lock_sum" ]; then
  log "npm: node_modules matches package-lock.json"
else
  log "npm: running npm ci"
  if ( cd "$ROOT/web" && npm ci --no-audit --no-fund --loglevel=error ); then
    echo "$lock_sum" > "$stamp"
  else
    log "WARN: npm ci failed"
  fi
fi

# ---------------------------------------------------------------------------
# Playwright Chromium: the build web/package-lock.json resolves to
# ---------------------------------------------------------------------------
# Checked by launching it, not by looking for a directory: a browser can be on
# disk and still refuse to start for a missing system library. The image's
# /opt/pw-browsers carries whatever build the image was made with, which
# drifts from the pinned @playwright/test.
chromium_launches() {
  ( cd "$ROOT/web" && timeout 60 node -e "
      require('@playwright/test').chromium.launch()
        .then(b => b.close()).then(() => process.exit(0))
        .catch(e => { console.error(String(e.message).split('\n')[0]); process.exit(1) })" )
}
if [ -d "$ROOT/web/node_modules/@playwright/test" ]; then
  if chromium_launches >/dev/null 2>&1; then
    log "playwright: chromium launches"
  else
    log "playwright: installing chromium and its system deps"
    ( cd "$ROOT/web" && $SUDO env "PATH=$PATH" npx playwright install-deps chromium >/dev/null 2>&1 ) \
      || log "WARN: playwright install-deps failed"
    ( cd "$ROOT/web" && npx playwright install chromium ) || log "WARN: playwright install failed"
  fi
fi

# ---------------------------------------------------------------------------
# Verify: run each tool, do not just look for it
# ---------------------------------------------------------------------------
missing=()
v_go="$(GOTOOLCHAIN=local go version 2>/dev/null)"
if [ "$(GOTOOLCHAIN=local go env GOVERSION 2>/dev/null)" = "go$want_go" ]; then
  log "verify: $v_go"
else
  missing+=("go$want_go (have: ${v_go:-none})")
fi
if v_sc="$(staticcheck -version 2>/dev/null)" && echo "$v_sc" | grep -qF "($want_sc)"; then
  log "verify: $v_sc"
else
  missing+=("staticcheck $want_sc")
fi
if v_sq="$(sqlite3 --version 2>/dev/null)"; then
  log "verify: sqlite3 ${v_sq%% *}"
else
  missing+=("sqlite3")
fi
if err="$(chromium_launches 2>&1)"; then
  log "verify: playwright chromium launches"
else
  missing+=("playwright chromium (${err:-no web/node_modules})")
fi

if [ ${#missing[@]} -eq 0 ]; then
  log "ready: scripts/check.sh and the e2e suite can run"
else
  for m in "${missing[@]}"; do log "MISSING: $m"; done
  log "not ready; see $LOG. Re-run: scripts/cloud-setup.sh --force"
fi
exit 0
