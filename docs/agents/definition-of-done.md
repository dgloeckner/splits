# Definition of Done (AFK agents)

This file is the canonical checklist an AFK implementation agent walks
before declaring an issue `done`. It applies to any issue whose `Type:`
line begins with `AFK ·`. HITL issues follow human review instead.

The issue template that produces the `Type:` line and the E2E sections
this DoD references lives in [`issue-tracker.md`](./issue-tracker.md).
The architectural rationale for the E2E gate is
[ADR-0014](../../specs/adr/0014-e2e-per-slice-gate-with-llm-critique.md).

## Universal gates (all AFK types)

1. **Acceptance criteria.** Every checkbox in the issue's `## Acceptance
   criteria` is satisfied by the diff. Untestable AC items are called out
   in the issue's `## Comments`.
2. **Unit / integration tests green.** Vitest (web), `go test` (backend),
   or whichever language-native runner covers the layer under change.
   Exit code 0.
3. **Spec coherence.** If the diff diverges from a referenced
   FEAT/INT/ADR, the spec is updated in the same commit.
4. **Small diff.** One concern. If the diff has sprawled to >~300 lines
   across unrelated files, re-scope before declaring done.

## Extra gates by `Type:`

### `Type: AFK · UI`

User-observable issues. The three E2E gate steps below are **mandatory**
in addition to the universal gates. They operationalise ADR-0014's
per-slice E2E gate.

1. **E2E walkthrough green.** The Playwright walkthrough described in
   the issue's `## E2E walkthrough` section runs to completion against
   the real `splits` Go binary + Vite frontend and exits with code `0`.
2. **E2E spot-checks green.** Every assertion in the issue's `## E2E
   spot-checks` section passes. Same Playwright run, same exit code `0`
   requirement.
3. **`e2e-critic` returns no blockers.** The `e2e-critic` sub-agent (see
   `.claude/agents/e2e-critic.md`) is invoked with the scenario name,
   the AC list, and the ordered screenshot paths the walkthrough
   produced. The gate passes iff:
   - the sub-agent exits with code `0`, and
   - its JSON output contains zero findings with `severity: "blocker"`.

   A non-zero exit code from the sub-agent — for any reason, including
   input-parse failure or tool errors — fails the gate. `warning` and
   `nit` findings are advisory; they append to the issue's `##
   Comments` for the next iteration but do not block.

#### Selector hygiene (soft)

New user-facing elements should ship with a stable `data-testid` so the
walkthrough can address them deterministically. The `e2e-critic` will
flag missing selectors as `severity: warning` when they would have
helped. This is a soft convention, not a gate.

### `Type: AFK · Backend`

The three E2E gate steps above are **skipped**. Backend issues are
covered by `go test` plus, where the issue touches a wire-format or
state-machine boundary, an integration test against the real binary.

### `Type: AFK · Docs`

The three E2E gate steps are **skipped**. Documentation issues pass when
the affected docs render correctly (markdown lints clean, cross-links
resolve) and the universal gates are satisfied. No app run required.

### `Type: AFK · Infra`

The three E2E gate steps are **skipped** unless the infra change is
itself part of the E2E harness (in which case ADR-0014's tracer-bullet
sanity test covers it). Infra changes pass when the affected pipeline,
script, or build target works on a clean checkout.

## When the gate fails

- A failing universal gate is a normal test failure: fix and re-run.
- A failing E2E walkthrough or spot-check is a normal Playwright
  failure: fix and re-run.
- A failing `e2e-critic` gate (any `severity: blocker` finding) is a UX
  defect surfaced by the vision-LLM critic. The agent reads the
  finding's `detail`, either fixes the implementation or — if the
  finding's `suggested_ac` indicates the AC list itself was
  under-specified — opens a follow-up issue rather than silencing the
  finding.

## Pointers

- Issue template + soft `data-testid` convention: [`issue-tracker.md`](./issue-tracker.md)
- Triage labels: [`triage-labels.md`](./triage-labels.md)
- E2E gate rationale: [ADR-0014](../../specs/adr/0014-e2e-per-slice-gate-with-llm-critique.md)
- `e2e-critic` sub-agent: [`.claude/agents/e2e-critic.md`](../../.claude/agents/e2e-critic.md)
