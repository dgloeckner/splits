# PRD-0016: End-to-end test automation as the AFK-agent merge gate

Status: ready-for-agent

- **Owner**: @gloeckner
- **Implements**: [ADR-0014](../../specs/adr/0014-e2e-per-slice-gate-with-llm-critique.md)
- **Depends on**: existing Playwright E2E scaffold in `web/tests/e2e/`,
  PRD-0014 (Race Mode Cleanup), PRD-0015 (Race-flow Polish)
- **Date**: 2026-05-14

## Problem Statement

The AFK-agent implementation loop currently gates on unit/integration
tests in the language of the layer under change — Vitest for web,
`go test` for backend. PRD-0014 + PRD-0015 shipped 15 issues this way,
and a real bug still slipped through: an agent declared *"489 tests
pass / done"* while the running app rendered an empty canvas after
GO! because `LivePage`'s page container collapsed the inner grid row
to 0 px. The bug lived in the layout of the real running application,
downstream of every assertion the agent wrote. No unit test could
have caught it.

The user goal is twofold. First: acceptance criteria must be verified
**in the real running application**, not only at the layer where the
unit tests live. Second: someone or something must **criticise the
UX** — not just assert mechanical correctness — so that consequences
of design choices ("you can no longer see the boat at the start
line") surface before the rower does.

Two related pressures: agents work in parallel worktrees and currently
collide on hard-coded ports (Vite 5173, backend 8080, `splits.db`),
which the existing E2E scaffold makes explicit via
`test.describe.configure({ mode: 'serial' })`; and the `e2e-critic`
that produces the UX critique must be cleanly reusable rather than
re-derived per agent.

## Solution

Make end-to-end automation the AFK-agent merge gate, per ADR-0014:

- Every new **user-observable** issue ships with an `E2E walkthrough`
  (a user-story scenario driven through the real app) plus
  `E2E spot-checks` (negative-space and per-phase assertions). The
  implementation agent authors both as part of TDD, after unit tests
  are green.
- After the deterministic suite passes, the agent invokes a packaged
  **`e2e-critic` sub-agent** which receives the Playwright
  screenshots + scenario metadata + the issue's AC list, and returns
  structured JSON findings tagged by severity. `severity: blocker`
  hard-gates the merge; `warning` and `nit` are advisory. The JSON
  appends to the issue's `## Comments` section, and frequently takes
  the form *"the AC list says X but the screen shows Y, consider
  adding AC: Z"* — i.e. an AC-strengthening feedback loop.
- Parallel agents isolate via dynamic ports (free port picked per
  run for Vite + backend) and per-worktree state (SQLite DB path,
  `test-results/` directory). Up to 5-way parallel works on a typical
  dev machine without coordination.
- Race-mode E2E uses a dev-mode-only **`POST /test/fixture/resume`**
  endpoint to give tests deterministic phase-boundary timing — the
  fixture replayer starts paused and the test releases it at the
  correct moment (e.g. immediately for Falschstart-at-ATTENTION,
  after GO! for the happy path).
- The first three retrofitted scenarios are the canonical race-flow
  scenarios: full happy path with ghost + PB present, Falschstart at
  ATTENTION/SET, abort from each phase.

## User Stories

1. As a developer reviewing an agent's "done" report, I want the
   agent's gate to include real-app behaviour, so I don't see another
   "all tests pass" claim alongside an obviously broken UI.
2. As an AFK agent finishing an issue, I want a single command that
   runs my walkthrough + spot-checks + critic pass and tells me
   whether I can merge, so I don't have to assemble the gate myself.
3. As an AFK agent, I want the deterministic part of the gate to be
   reproducible, so my "done" decision is not flaky.
4. As an AFK agent, I want the qualitative part of the gate to come
   from a sub-agent I invoke, so the critique prompt is centralised
   and version-controlled, not re-derived in every agent run.
5. As a developer running parallel agents in different worktrees, I
   want each agent's E2E run to use its own Vite + backend ports, so
   simultaneous runs do not collide.
6. As a developer running parallel agents, I want each agent's SQLite
   DB to live in its worktree, so state leaks between runs are
   impossible.
7. As an AFK agent writing an `E2E walkthrough`, I want a per-feature
   folder (e.g. `web/tests/e2e/race/`) so my specs collocate with
   prior art for the same surface.
8. As an AFK agent writing a `E2E walkthrough` for race mode, I want
   a test-only HTTP endpoint that releases the fixture replay, so I
   can deterministically produce a stroke during ATTENTION (1500 ms
   window) for Falschstart tests.
9. As a developer, I want the test-only endpoint to be mounted only
   when `SPLITS_DEV_MODE=1`, so production cannot accidentally expose
   it.
10. As an AFK agent retrofitting the happy-path scenario, I want a
    helper that seeds a prior session via the backend API, so ghost +
    PB are populated and the canonical race scenario exercises both
    opponent kinds.
11. As an AFK agent retrofitting a Falschstart scenario, I want the
    test to release the fixture immediately after Bereit tap and
    before ATTENTION expires, so the first stroke deterministically
    triggers Falschstart at ATTENTION.
12. As an AFK agent retrofitting the abort-from-each-phase scenario,
    I want a Playwright helper that drives the AbortControl pill and
    confirms summary.race = null afterwards via the API, so the
    backend invariant is asserted end-to-end.
13. As an AFK agent, I want the `e2e-critic` to receive my issue's
    full AC list, so its findings map back to existing ACs (or
    propose new ones).
14. As a developer reading the issue file after a critic pass, I want
    the critic's JSON appended to the `## Comments` section with
    severity tags and screen references, so I can decide whether to
    accept the suggested ACs or override.
15. As a developer maintaining the issue template, I want the new
    `## E2E walkthrough` and `## E2E spot-checks` sections to be
    mandatory only on user-observable issues, so backend-only agents
    do not need to learn Playwright.
16. As an AFK agent picking up a backend-only issue (e.g. a sample
    trimmer change), I want the issue template to tell me E2E is
    skipped, so I do not block on an unnecessary gate.
17. As a developer adding a new user-facing element, I want `data-testid`
    to be a soft convention not a hard gate, so I can ship without
    fighting the gate, but the LLM critique will flag missing
    stable selectors when they would have helped.
18. As an AFK agent writing a walkthrough, I want existing pages
    (BereitScreen, FinishOverlay, AbortControl) to expose stable
    selectors, so my walkthrough does not need to query by text
    content alone.
19. As a developer, I want the `e2e-critic` to be a single,
    well-tested sub-agent definition, so multiple AFK agents share
    the same critique semantics.
20. As an AFK agent on a happy-path scenario, I want the walkthrough
    to take well under one minute of wall clock at fast fixture
    rate, so the gate doesn't dominate my loop.
21. As a developer reviewing a `severity: warning` finding, I want a
    clear path to either escalate it to AC-level (next PRD) or
    dismiss it (mark `wontfix` in the Comments thread), so the
    advisory bucket does not turn into perpetual noise.
22. As a developer, I want the canonical retrofit scenarios to act as
    a teaching corpus for forward-direction agents, so new agents
    have prior art for walkthroughs, spot-checks, fixture seeding,
    resume-endpoint usage, and critic invocation.

## Implementation Decisions

The work splits into one infra slice (blocks everything else) and a
retrofit slice of three canonical race-flow scenarios. After both, the
issue template change makes the per-slice gate the new default.

### Deep modules to build

- **Dynamic-port helper.** A tiny utility that picks a free TCP port
  on demand. The Playwright fixture asks for two ports per run (one
  for Vite, one for the backend) and threads them through the
  backend spawn (`SPLITS_ADDR`) and Vite startup (`--port`). The
  Playwright `baseURL` reads from env (`PLAYWRIGHT_BASE_URL`,
  derived per-run). Deep because callers only see "give me a free
  port"; the implementation details (probing, retry on race) live
  behind one function.

- **Fixture-resume endpoint (backend, dev-mode only).** A new HTTP
  handler `POST /test/fixture/resume` mounted only when
  `SPLITS_DEV_MODE=1`. The fixture replayer gains a `paused` flag,
  default `false` for backward compatibility; a new env var
  `SPLITS_FIXTURE_PAUSED=1` starts the replayer paused. A POST to
  the endpoint flips `paused = false` and starts (or continues) the
  schedule. This is what makes Falschstart-at-ATTENTION
  deterministically testable.

- **`e2e-critic` sub-agent.** A packaged sub-agent (definition lives
  under the project's agent-definition root) that takes:
  - the scenario name,
  - an ordered list of screenshot paths,
  - the issue's AC list,
  - a brief description of what each screenshot represents,
  and returns structured JSON:
  ```text
  {
    "findings": [
      { "severity": "blocker" | "warning" | "nit",
        "screen": "<scenario-step-id>",
        "ac_reference": "<AC number or null>",
        "summary": "<one-line>",
        "detail": "<paragraph>",
        "suggested_ac": "<proposed new AC text, or null>" }
    ]
  }
  ```
  Deep because the implementation agent only knows
  *"invoke `e2e-critic` with these inputs"* — the prompt, the
  vision-LLM call, the JSON validation all live inside the
  sub-agent.

- **Race-mode E2E helpers.** A small helper module
  (`web/tests/e2e/helpers/`) gains: `seedPriorRaceSession()`
  (POSTs a prior session so ghost + PB are present),
  `resumeFixture()` (POSTs to the test endpoint), and
  `assertSummaryRaceNull()` (polls the sessions API after an abort).

### Modules to modify

- **Playwright config + fixtures.** `playwright.config.ts` reads
  `baseURL` from env (with a localhost:5173 default for human runs).
  `helpers/backend.ts` drops `killAnyOn8080()` in favour of the
  dynamic-port helper. The existing `test.describe.configure({ mode:
  'serial' })` blocks are removed from race specs; legacy specs
  may keep them or migrate at their own pace.

- **Fixture replayer (backend).** Add the `paused` flag and the env
  var hook. No change to fixture parsing or scheduling logic — the
  scheduler simply does not start ticking until unpaused.

- **Issue template.** Add two sections to the template:
  ```text
  ## E2E walkthrough
  <one-paragraph user-story scenario>

  ## E2E spot-checks
  - <per-phase or negative-space assertion>
  - ...
  ```
  Both are mandatory for `Type: AFK · UI` issues and skipped for
  `Type: AFK · Backend` issues. The PRD author classifies the type.

- **Agent DoD documentation.** The agent's "done" criteria gains the
  steps: (a) E2E walkthrough green, (b) all E2E spot-checks green,
  (c) `e2e-critic` returns no `severity: blocker` findings. (a) and
  (b) are mechanical exit codes; (c) is parsed from the critic JSON.

### Interfaces and contracts

- `POST /test/fixture/resume` returns 200 OK with body `{ "started": true }`
  if the fixture was paused and is now running, or `{ "started": false,
  "reason": "already_running" | "no_fixture" }` otherwise. 404 in
  non-dev-mode builds.
- `e2e-critic` input is structured (JSON file path or stdin JSON);
  output is structured JSON to stdout. Non-zero exit code if any
  finding has `severity: blocker`. Documented in the sub-agent
  definition.
- Playwright `baseURL` env var: `PLAYWRIGHT_BASE_URL` (used by the
  config). Backend port env var: `SPLITS_ADDR` (existing). Fixture
  pause env var: `SPLITS_FIXTURE_PAUSED` (new).
- `data-testid` is a soft convention. New user-facing elements
  should ship with one; the critic flags missing selectors as a
  `warning` when they would have helped the walkthrough.

### Architectural decisions re-stated

- Per-slice gate, not nightly (Q1 / ADR-0014).
- Hybrid deterministic + LLM critique (Q4 / ADR-0014).
- Implementation agent authors walkthrough + spot-checks; invokes
  packaged `e2e-critic` (Q6).
- Dynamic ports + worktree-local state for parallel agents (Q3).
- Dev-mode test endpoint, not stroke injection (Q7).
- Folder layout by user-facing feature, not by PRD (Q8).

## Testing Decisions

A good test for this PRD exercises *the gate itself* — does an agent
that ships a regression of the empty-canvas class fail the gate? It
does not assert on internals of the dynamic-port helper or on the
critic's prompt verbatim.

### Modules to test

1. **Dynamic-port helper.** Two ports requested in quick succession
   return distinct, free ports; a port returned is bindable. Probably
   covered by a single Vitest unit.
2. **Fixture-resume endpoint (backend).** Go test: replayer started
   with `SPLITS_FIXTURE_PAUSED=1` does not emit strokes until
   `POST /test/fixture/resume` returns 200. Repeat call returns
   `already_running`. Non-dev build returns 404.
3. **Canonical race-flow scenarios (Playwright).**
   - Happy path: full walkthrough; assert boats visible from
     ATTENTION; assert FinishOverlay over canvas; assert post screen
     shows latched values; critic returns no blocker.
   - Falschstart at ATTENTION: resume fixture immediately after
     Bereit tap; assert Falschstart toast appears; assert race
     clock starts at GO!; race finishes; summary.race is non-null.
   - Falschstart at SET: similar, resume 1500 ms after Bereit tap.
   - Abort from each phase: tap Abbrechen → confirm → assert race
     surface unmounted, summary.race = null via API.
4. **`e2e-critic` sub-agent.** A small integration test: feed a
   known-bad screenshot (e.g. the historical empty-canvas
   regression captured to a fixture file) + the AC list, assert the
   returned JSON includes a `severity: blocker` finding referencing
   a missing user boat / track. Probably the cheapest way to keep
   the critic honest as the prompt evolves.

### Prior art

- `web/tests/e2e/live-view-real-backend.spec.ts` — the existing
  Playwright pattern for real backend + fixture replay.
- `web/tests/e2e/fixtures.ts` — the fixture/page-object plumbing
  to extend.
- `web/tests/e2e/helpers/backend.ts` — the backend spawn helper that
  gains dynamic-port + resume-endpoint awareness.
- `backend/internal/config/config.go` — where `SPLITS_FIXTURE_*` env
  vars are defined; `SPLITS_FIXTURE_PAUSED` joins them.
- `web/src/race/RaceFlow.test.tsx` — pattern for asserting per-phase
  state in component tests; spot-checks reuse the same `data-testid`s.

## Out of Scope

- Retrofitting E2E for backend-only issues (PRD-0014 / 0014-02,
  0014-09). They already have Go tests; adding E2E would not have
  caught the empty-canvas bug class.
- A general visual-regression baseline (screenshot diffing against a
  golden). Different problem; can be added later if desired.
- CI integration (no GitHub remote on this repo; the per-slice gate
  runs in the agent's own worktree).
- Vision-LLM critique on non-race PRDs. Forward-only after this PRD
  lands; retrofitting non-race E2E is not required for the goal
  of closing the empty-canvas class.
- Migrating legacy specs (`history.spec.ts`, `insights.spec.ts`,
  `v1-flows.spec.ts`) off `mode: 'serial'`. Each can migrate
  opportunistically when next touched; they're not the headline.
- IPM-hardware-in-the-loop testing. Fixture replay over the real
  pipeline is the "real application" boundary for this PRD.

## Further Notes

- ADR-0014 is the architectural record for this PRD; PRD-0016 turns
  that decision into a concrete implementation plan.
- This PRD is published under `.scratch/e2e-automation/` per
  `docs/agents/issue-tracker.md`.
- Suggested implementation order (matches Q8's roll-up):
  1. **Infra slice** — dynamic-port helper, fixture-resume endpoint
     (backend), Playwright config + fixtures pass-through, issue
     template update, agent DoD update, `e2e-critic` sub-agent
     definition.
  2. **Canonical retrofit** — happy path; Falschstart at ATTENTION
     and SET; abort from each phase.
  3. **Soft convention** — add `data-testid` to user-facing
     elements the canonical scenarios needed but did not find;
     publish the soft-convention note in the issue template
     guidance.
- The 5-way parallel-agent constraint is the explicit test of the
  infra slice. The implementation agent should validate by running
  two scenarios in parallel against the same machine and confirming
  no port/DB collisions occur.
- The `e2e-critic` sub-agent's prompt is the load-bearing piece for
  the qualitative-feedback quality. It should be tuned against the
  historical empty-canvas regression (the canonical bug this PRD
  closes) so that prompt regressions are easy to detect.
