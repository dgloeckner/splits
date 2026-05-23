# 0019-11 — E2E harness caches splits binary indefinitely

Status: ready-for-agent

- **Type**: AFK · Test infrastructure
- **Parent**: [PRD-0019](../PRD.md)
- **Surfaced by**: Investigation of e2e failures during the
  pause→discard backend fix. Backend changes weren't actually under
  test until the cache was manually cleared.

## What's broken

`web/tests/e2e/helpers/backend.ts:17-29`:

```ts
export function ensureSplitsBinary(): string {
  if (existsSync(BIN_PATH)) return BIN_PATH
  mkdirSync(dirname(BIN_PATH), { recursive: true })
  const r = spawnSync('go', ['build', '-o', BIN_PATH, './cmd/splits'], ...)
  ...
}
```

The cache is keyed purely on file existence. Once
`node_modules/.cache/splits-e2e/splits` exists, every subsequent
e2e run reuses it — even if every `.go` source file under
`backend/` has changed. The harness saves ~30 s per worker startup
when the cache is warm, which matters a lot for parallel agent
runs.

The cost: any e2e run after a backend change implicitly tests
**HEAD-of-backend at the moment the cache was created**, not the
current working tree. This produced a real false-positive during
this session: `freeze.spec.ts` appeared to fail under HEAD but
passed once the binary was rebuilt; the falschstart/happy-path
race-timing failures were temporarily hard to triage because it
was unclear whether the binary even contained the backend changes
under investigation.

## What to build

Replace existence-check with a build-tree fingerprint. The
fingerprint should be cheap to compute and invalidate on any
backend source change.

Two viable shapes:

### Option A — mtime of newest `.go` source file

```ts
const BIN_MTIME = existsSync(BIN_PATH) ? statSync(BIN_PATH).mtimeMs : 0
const NEWEST_SRC = walkBackendDir().reduce(
  (acc, p) => Math.max(acc, statSync(p).mtimeMs),
  0,
)
if (BIN_MTIME > NEWEST_SRC) return BIN_PATH
// otherwise rebuild
```

Cheap (one `readdir` walk over `backend/`), no hashing, no
toolchain bookkeeping. Misses cross-module changes (e.g.
`go.mod` / `go.sum` updates) unless they also bump file mtimes,
but those usually do.

### Option B — defer to `go build` entirely

Always shell out to `go build -o BIN_PATH ./cmd/splits`. Go's own
build cache is keyed on source content + module graph + build
flags and is fast for incremental rebuilds (~200 ms when nothing
changed). The overhead vs Option A is ~150-200 ms per worker
startup, paid once.

Option B is the more correct version (it inherits Go's full
dependency tracking, including stdlib + module changes), and the
overhead is small enough that the "save 30 s" argument no longer
applies. Recommend Option B.

## Acceptance criteria

- [ ] Modifying any `.go` file under `backend/` and rerunning the
      e2e suite causes the splits binary to be rebuilt before the
      first test runs.
- [ ] When no backend source has changed, e2e startup overhead per
      worker stays under ~1 s (Option B's `go build` cache is
      effectively a no-op).
- [ ] CI behaviour unchanged when no cache exists (first run
      rebuilds as today).
- [ ] No race condition when multiple Playwright workers spawn
      simultaneously and the binary doesn't yet exist (today the
      `existsSync` check is racy too — workers may collide on
      `go build -o`). Either serialise via a `Mutex` /
      `lockfile`, or rely on `go build`'s own atomicity (it writes
      to a temp file and renames).

## E2E spot-checks

- Manual: touch `backend/internal/session/sessionizer.go`, rerun
  one e2e spec, observe `go build` runs.
- Manual: rerun the same spec twice in a row without touching
  source; the second run does not re-link.

## Blocked by

None.

## Follow-up (not in this slice)

The same harness file exposes a few other test-infra cliffs worth
revisiting once this lands:

- `BIN_DIR` is shared across worktrees (`node_modules/.cache/...`).
  Multiple parallel-agent worktrees each have their own
  `node_modules`, so this is fine in practice, but worth a comment.
- The fixture-resume helper assumes single-tenant ownership of the
  backend's `/test/fixture/resume` endpoint. With multi-worker
  runs and per-worker backends that's also fine, but the helper
  could fail more loudly if hit against a non-fixture backend
  (currently returns `409 no_fixture` and the test fails
  downstream).
