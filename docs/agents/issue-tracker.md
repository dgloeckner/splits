# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`. This repo has no git remote configured; there is no GitHub/GitLab tracker.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Canonical issue template

The shape below is what PRD authors should produce. The two E2E sections
(`E2E walkthrough`, `E2E spot-checks`) are **mandatory on `Type: AFK · UI`**
issues and **skipped on `Type: AFK · Backend` / `AFK · Docs` / `AFK · Infra`
/ `HITL`**. The agent's Definition of Done (see `definition-of-done.md`) reads
the `Type:` line to decide which gates apply. The architectural rationale for
the E2E gate lives in [ADR-0014](../../specs/adr/0014-e2e-per-slice-gate-with-llm-critique.md).

```text
# <NNNN-NN> — <title>

Status: ready-for-agent

- **Type**: AFK · UI | AFK · Backend | AFK · Docs | AFK · Infra | HITL
- **Parent**: [PRD-NNNN](../PRD.md)

## What to build

<what changes and why; reference specs/FEAT/INT/ADR where relevant>

## Acceptance criteria

- [ ] <user- or system-observable criterion>
- [ ] ...

## E2E walkthrough            ← mandatory for Type: AFK · UI; skipped otherwise

<one-paragraph user-story scenario the Playwright walkthrough must
exercise end-to-end, e.g. "Rower lands on Bereit, taps Bereit, sees
ATTENTION → SET → GO!, pulls their first stroke after GO!, the canvas
renders their boat at the start line and animates forward.">

## E2E spot-checks            ← mandatory for Type: AFK · UI; skipped otherwise

- <per-phase or negative-space assertion, e.g. "Canvas height > 0 after GO!">
- <e.g. "No live subscription opens before Bereit is tapped">
- ...

## Blocked by

- <other issue ID, or "None — can start immediately.">
```

### Soft `data-testid` convention

New user-facing elements should ship with a stable `data-testid` so the
walkthrough can address them deterministically. The `e2e-critic` sub-agent
will flag missing selectors as `severity: warning` when they would have
helped the walkthrough; it is not a hard gate, but it is the path of least
resistance.

## Related conventions in this repo

Long-lived feature specs and ADRs live under `specs/feat/` and `specs/adr/` (see `specs/README.md`). Those are durable design records, not triage tickets — keep `.scratch/` for in-flight issues and PRDs that haven't yet been promoted to a spec.

The agent's Definition of Done — the checklist that closes an AFK issue —
lives in [`definition-of-done.md`](./definition-of-done.md).
