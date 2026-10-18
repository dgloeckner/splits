# Issue tracker: GitHub Issues

Issues and PRDs for this repo live as GitHub Issues on
[`dgloeckner/splits`](https://github.com/dgloeckner/splits/issues).

`.scratch/` holds the PRDs and issue files written before the repo had a
remote. It is read-only history: link to it, do not add to it.

## Conventions

- One issue per independently shippable slice. A PRD or a multi-stage feature
  is an issue labelled `epic`, and its stages link back to it ("Part of #1").
- Triage state and priority are labels (see `triage-labels.md`). Area labels
  such as `offline` group related issues.
- A PR closes its issue with a closing keyword (`Closes #25`).
- Agents have no `gh` in a cloud session; use the GitHub MCP tools.

## When a skill says "publish to the issue tracker"

Create a GitHub issue on `dgloeckner/splits` with the template below, and
apply `needs-triage` (or the triage label the skill names).

## When a skill says "fetch the relevant ticket"

Read the GitHub issue and its comments. The user will normally pass the issue
number or URL.

## Canonical issue template

The shape below is what PRD authors should produce. The two E2E sections
(`E2E walkthrough`, `E2E spot-checks`) are **mandatory on `Type: AFK · UI`**
issues and **skipped on `Type: AFK · Backend` / `AFK · Docs` / `AFK · Infra`
/ `HITL`**. The agent's Definition of Done (see `definition-of-done.md`) reads
the `Type:` line to decide which gates apply. The architectural rationale for
the E2E gate lives in [ADR-0014](../../specs/adr/0014-e2e-per-slice-gate-with-llm-critique.md).

```text
<title>                       ← the issue title; triage state is a label

- **Type**: AFK · UI | AFK · Backend | AFK · Docs | AFK · Infra | HITL
- **Parent**: #<epic issue>

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

- <#issue, or "None — can start immediately.">
```

### Soft `data-testid` convention

New user-facing elements should ship with a stable `data-testid` so the
walkthrough can address them deterministically. The `e2e-critic` sub-agent
will flag missing selectors as `severity: warning` when they would have
helped the walkthrough; it is not a hard gate, but it is the path of least
resistance.

## Related conventions in this repo

Long-lived feature specs and ADRs live under `specs/feat/` and `specs/adr/` (see `specs/README.md`). Those are durable design records, not triage tickets — keep GitHub issues for in-flight work that hasn't yet been promoted to a spec.

The agent's Definition of Done — the checklist that closes an AFK issue —
lives in [`definition-of-done.md`](./definition-of-done.md).
