# 0016-04 — Issue template + agent DoD update

Status: ready-for-agent

- **Type**: AFK · Docs
- **Parent**: [PRD-0016](../PRD.md)

## What to build

Update the issue template (`docs/agents/issue-tracker.md` or whatever
holds the canonical template — discover by inspecting existing issue
files for shape and matching docs) to include two new sections for
user-observable issues:

```text
## E2E walkthrough
<one-paragraph user-story scenario>

## E2E spot-checks
- <per-phase or negative-space assertion>
- ...
```

Mandatory on `Type: AFK · UI` issues; skipped on `Type: AFK · Backend`
issues. PRD authors classify the type via the existing `Type:` line at
the top of the issue file.

Update the agent's Definition of Done (look for an existing
`DoD.md` / `agent-rules.md` / similar — discover; if no canonical
doc exists, add one under `docs/agents/`) to include the three new
E2E gate steps:

1. E2E walkthrough green (Playwright exit code 0).
2. All E2E spot-checks green (same).
3. `e2e-critic` sub-agent returns no `severity: blocker` findings
   (sub-agent exit code 0).

Note the soft `data-testid` convention: new user-facing elements
should ship with a stable `data-testid`; the critic will flag missing
selectors as `warning` when they would have helped the walkthrough.

## Acceptance criteria

- [ ] Issue template grows `## E2E walkthrough` and `## E2E spot-checks` sections.
- [ ] Template documentation states these are mandatory on `Type: AFK · UI` and skipped on `Type: AFK · Backend`.
- [ ] Agent DoD documents the three new gate steps (walkthrough green, spot-checks green, no critic blockers).
- [ ] Soft `data-testid` convention is documented.
- [ ] No existing issue is retroactively modified — the template applies forward.

## Blocked by

None — can start immediately.
