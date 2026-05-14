# ADR-0014: Per-slice E2E gate with deterministic spot-checks + vision-LLM critique

- **Status**: Accepted
- **Date**: 2026-05-14

## Context

The AFK-agent implementation loop currently gates on unit/integration tests in
the language of the layer under change (Vitest for web, `go test` for
backend). PRD-0014 / 0015 shipped 15 issues this way, and one bug class
slipped through: an agent declared `489 tests pass / done`, but the actual
running app rendered an empty canvas after GO! because `LivePage`'s page
container collapsed the inner grid row to 0 px (see PRD-0015 / 0015-01). No
unit or component test could catch it — the bug lived in the layout of a
real running app, downstream of every assertion the agent wrote.

The user goal: agents must verify acceptance criteria *in the real
application*, and someone (or something) must *criticise the UX*, not just
assert mechanical correctness.

Existing E2E infrastructure (`web/tests/e2e/`) uses Playwright with the
real `splits` Go binary replaying an IPM CSV fixture against a real Vite
dev frontend. Backend on `127.0.0.1:8080`, Vite on `5173`, serialised
across tests (`test.describe.configure({ mode: 'serial' })`). No vision-LLM
critique exists. No per-slice gate exists.

## Options considered

### Option A — Forward-only per-slice deterministic gate

Every new user-observable issue ships with a Playwright walkthrough +
spot-checks. Failure blocks merge. No vision-LLM step. Lowest cost.
**Misses the "criticise UX" goal entirely**: the empty-canvas class of
bug, which lives outside what anyone thought to assert, would still
slip through.

### Option B — Nightly regression suite, not per-slice

Maintains a separate Playwright suite that runs after merges. Catches
regressions but not pre-merge bugs. Reopens the "agent said done, but it
wasn't" gap.

### Option C — Per-slice deterministic gate + vision-LLM critique (Accepted)

Each user-observable issue carries an `E2E walkthrough` (user-story
scenario) and `E2E spot-checks` (per-phase, negative-space assertions).
The implementation agent authors both as part of TDD. After the
deterministic suite passes, the agent invokes a packaged `e2e-critic`
sub-agent which receives Playwright screenshots + scenario metadata +
the issue's AC list, and returns structured JSON of findings tagged by
severity. `severity: blocker` findings hard-gate; `warning` / `nit`
are advisory. The JSON appends to the issue's `## Comments` section.

### Option D — Per-slice gate, deterministic only, with required visual-presence assertions

Same per-slice gate as C, but the agent must write deterministic
presence-checks for every "should be visible" property; no LLM step.
Catches what you remembered; misses what you didn't think to assert
(the empty-canvas class of bug originates exactly from gaps in the AC
list).

## Decision

**Option C.** Per-slice gate combining deterministic walkthrough +
spot-checks (mechanical, repeatable, blocks merge) with vision-LLM
critique (qualitative, soft-gate unless `blocker`, appended to issue
comments).

The dev-mode-only `POST /test/fixture/resume` endpoint is part of this
decision: it is what makes Falschstart-at-ATTENTION deterministically
testable (1500 ms window). The endpoint mounts only when
`SPLITS_DEV_MODE=1` (already set in e2e harness), and is invoked by the
test fixture at the deterministic moment.

## Consequences

### What becomes easier

- Agents declaring "done" actually means the real app behaves as the AC
  describes; the empty-canvas regression class is closed.
- The `e2e-critic` output is a natural feedback loop into AC quality —
  findings frequently take the form "the AC list says X but the screen
  shows Y, consider adding AC: Z."
- Parallel agents work end-to-end without colliding (dynamic ports for
  Vite + backend, per-worktree SQLite DBs, per-worktree
  `test-results/`).
- The vision-LLM critic prompt is centralised in the `e2e-critic`
  sub-agent, not duplicated across every agent invocation.

### What becomes harder

- New user-observable issues must carry `E2E walkthrough` + `E2E
  spot-checks` sections in the issue template; backend-only issues
  skip them. PRD authors must classify issue type
  (`Type: AFK · UI` vs `Type: AFK · Backend`).
- Per-slice E2E adds ~30–60 s wall-clock to the agent's loop. Acceptable
  given the bug-class it closes.
- Vision-LLM critique is non-deterministic on margin-of-judgment cases.
  The hard-gate property is preserved by limiting LLM influence to
  `severity: blocker` (rare, explicit) and treating `warning`/`nit` as
  advisory.
- A small backend change (`POST /test/fixture/resume`, dev-mode-gated)
  is now part of the E2E contract. Ripping it out breaks every race
  scenario.

### What we have to do as a result

- Build the infra slice: dynamic-port helper, fixture-resume endpoint,
  Playwright config reading `baseURL` from env, fixture helper
  pass-through, `e2e-critic` sub-agent definition, issue template
  update, agent DoD update.
- Retrofit three canonical race-flow scenarios (happy path, Falschstart
  at ATTENTION/SET, abort-from-each-phase) using the new infra.
- Document the `data-testid` soft convention so new user-facing
  elements ship with stable selectors.
