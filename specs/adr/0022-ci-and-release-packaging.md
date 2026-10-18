# ADR-0022: CI and Release Packaging

- **Status**: Accepted
- **Date**: 2026-10-18
- **Relates to**: [ADR-0001](0001-deployment-targets.md) (Deployment Targets), [ADR-0003](0003-tech-stack-go-react.md) (Tech Stack), [ADR-0017](0017-deterministic-replay-harness-ci-seam.md) (CI seam)

## Context

Until now nothing ran automatically: `go test`, `vitest` and Playwright
were invoked by hand or by an agent, and the only way to get a build
onto the Pi was to run `deploy/bundle.sh` on a workstation and `scp`
the tarball. ADR-0001 asks for deployment artefacts that are "a single
static binary + a static web bundle" and explicitly says "avoid per-OS
installers". ADR-0003 says linting runs "in CI" but no CI existed.

The household scenario needs a download-and-run path: someone with a
Pi and no Go/Node toolchain should be able to fetch a package and
install it.

## Options considered

### Option A — GitHub Actions, tag-driven releases + rolling nightly

Two workflows: `ci.yml` (vet, staticcheck, `go test -race`, eslint,
tsc, vitest, Playwright on every PR and push to `main`) and
`release.yml` (build `web/dist` once, cross-compile the four Linux
targets via the existing `deploy/bundle.sh`, attach the tarballs plus
`SHA256SUMS` to a GitHub Release). A `v*` tag produces a versioned
release; every push to `main` refreshes one `nightly` pre-release in
place, so the download URL per target is stable.

Pros: zero infrastructure, reuses `bundle.sh` unchanged in shape,
`gh` CLI is preinstalled on runners so no third-party release action is
needed. Cons: tied to GitHub.

### Option B — Goreleaser

Pros: mature, handles checksums, changelogs, Homebrew taps. Cons: a
new dependency and config language for four `go build` invocations; it
wants to own the Go build and does not know about `web/dist` or
`deploy/` without `extra_files` gymnastics. Not worth it at this size.

### Option C — Docker image on GHCR

Pros: one `docker run`. Cons: ADR-0001 already notes that USB-serial
passthrough into containers "gets gnarly"; no Dockerfile exists; the
Pi Zero 2 W has 512 MB RAM. Possible later, not the first package.

### Option D — Mac / Windows archives too

ADR-0001 names Mac and Windows as first-class targets. But the backend
does not serve the PWA — Caddy does (`deploy/Caddyfile.template`), and
`deploy/install.sh` is systemd-only — so a darwin/windows zip would be
a bare binary with no working install path. Shipping it would promise
more than it delivers.

## Decision

**Option A.** Specifically:

- `ci.yml`: three independent jobs (backend, web, e2e), all blocking.
  ESLint inside the web job is blocking too: it started advisory
  (`continue-on-error`) while `main` carried a backlog of pre-existing
  errors, and became blocking once that backlog was fixed. e2e runs
  with one worker per shard (each test spawns Vite + Go backend +
  Chromium; two workers starve each other on a 4-vCPU runner),
  excludes the capture-only
  suites (`theme-screenshots`, `ux-audit`) via `--grep-invert`, and
  retries a failed test once in CI; a pass on retry is reported as
  "flaky", never hidden. The race specs used to fail on timing; the
  causes and fixes are recorded in the specs themselves (fixture released
  only once the reducer is in Live, idle timeout longer than the
  pre-stroke stretch, PB overlay dismissed before Fertig, aborted
  session closed through the pause path). A guard
  step fails the job when Playwright reports zero tests, because a
  script that called `process.exit` on import once ended the run after
  three seconds with exit code 0. That script, the `e2e-critic`
  regression (ADR-0014), is now named `critic-regression.mjs` so it no
  longer matches Playwright's default `testMatch`; a `testIgnore` was
  not enough, since a project-level `testIgnore` replaces the top-level
  one.
- The job's `--grep-invert` filter is the one place a spec can be
  silently dropped; keep it to the capture-only suites.
- `release.yml`: runs on `push` to `main` and on tags `v*`. Bundles are
  named `splits-linux-<armv6|armv7|arm64|amd64>-<version>.tar.gz`;
  `bundle.sh` now uses the same `linux-<arch>` suffix as the binary so
  assets are unambiguous, and writes the commit hash as a second line
  of the bundled `VERSION` file.
- Versioning is the git tag. There is no version constant in Go yet.
- Only `actions/*` and the runner's `gh` CLI are used. Adding any other
  action needs a justification in the PR, per AGENTS.md rule 3.
- Mac/Windows/Docker packages are deferred until the backend can serve
  `web/dist` itself (which would also make ADR-0003's "single embedded
  binary" claim true — today it is not; Caddy serves the PWA) or an
  install path exists for those hosts.

## Coverage floors and build caches (amendment, 2026-10-18)

Borrowed from `dgloeckner/clubbar`'s `build.yaml` after reviewing it.

- **Coverage is a floor, not a target.** AGENTS.md rule 4 says tests
  matter, not counts, so CI only refuses to let coverage *fall*. The
  backend job writes an atomic coverage profile with its `-race` run and
  `scripts/check-coverage.sh` compares the total against
  `backend/.coverage-floor` (73.0 at introduction; measured 73.7). The web
  job runs `vitest --coverage` with the v8 provider and the thresholds in
  `web/vite.config.ts` are its floor (statements 85 / branches 77 /
  functions 84 / lines 88 at introduction; measured 85.7 / 77.9 / 84.5 /
  88.2 over `src/`, tests, `main.tsx` and type declarations excluded).
  Both are blocking. Coverage instrumentation slows jsdom tests, so the
  vitest `testTimeout` went from 5 s to 15 s. The rule: a
  floor is never lowered; the PR that raises coverage raises the floor.
  Per-package floors and a patch-coverage gate (80 % of changed lines,
  as clubbar does) were considered and deferred; the total floor already
  blocks regressions.
- **Caches.** `actions/setup-go` already caches the module and build
  caches keyed on `go.sum`, which covers `go test`, staticcheck and the
  e2e helper's `go build`; do not add a second Go cache. Playwright's
  browser directory is cached keyed on `web/package-lock.json`, so the
  ~280 MB Chromium download happens once per lockfile change; the apt
  system deps are installed every run (~20 s). The e2e job's own
  `vite build` (offline-preview project) is not shared with the web job:
  linking them would make e2e wait on web to save 30 s.
- **e2e runs in two shards**, one worker each: each test spawns Vite,
  the Go backend and Chromium, so a second worker on one runner starves
  the first, while a second runner halves the wall time.
- Runners are pinned to `ubuntu-24.04`, every job has `timeout-minutes`,
  and `release.yml` grants `contents: write` only to the publish job.

## Consequences

- `deploy/README.md` gains an "Install from a release" section; the
  workstation build path stays documented below it.
- A green `main` is a precondition for a usable `nightly`: the release
  workflow does not wait for `ci.yml`, so `main` should be protected
  by the three CI jobs. Tags are expected to be cut from `main`.
- Tag protection rules, if added, must allow the workflow to force-move
  the `nightly` tag (scope rules to `v*`).
- `__BUILD_SHA__` in `web/vite.config.ts` is derived from `git` at
  build time; both workflows assert the tree is clean after `npm ci` so
  a CI build can never be stamped `-dirty`.
- Follow-ups, not in this ADR: the race abort should end the backend
  session (today it only unmounts the race surface; a rower who stops
  rowing is closed by the pause detector); a patch-coverage gate on
  changed lines; SHA-pinned actions with Dependabot; a
  `splits --version` flag populated via `-ldflags -X`; a golden-fixture
  freshness check (ADR-0017); Dependabot for action versions; serving
  the PWA from the Go binary.
