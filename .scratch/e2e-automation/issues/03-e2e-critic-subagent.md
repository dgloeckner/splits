# 0016-03 — `e2e-critic` sub-agent

Status: ready-for-agent

- **Type**: AFK · Infra
- **Parent**: [PRD-0016](../PRD.md)

## What to build

Define a packaged sub-agent (under the project's agent-definition
root, e.g. `.claude/agents/e2e-critic.md` or wherever existing
sub-agents live — discover the convention by inspecting current agent
definitions) that takes a scenario's screenshots + the issue's AC list
and returns structured JSON of findings tagged by severity. The
implementation agent invokes it as the final step of the E2E gate.

### Sub-agent input

The implementation agent invokes the sub-agent with:

- `scenario_name`: short identifier (e.g. `race-happy-path`).
- `ac_list`: the issue's user-observable acceptance criteria,
  verbatim.
- `screens`: an ordered list of `{ step_id, screenshot_path,
  description }` entries.

### Sub-agent output (stdout, JSON)

```text
{
  "findings": [
    {
      "severity": "blocker" | "warning" | "nit",
      "screen": "<step_id>",
      "ac_reference": "<AC number or short label, or null>",
      "summary": "<one-line>",
      "detail": "<paragraph>",
      "suggested_ac": "<proposed new AC text, or null>"
    }
  ]
}
```

Exit code: non-zero iff any finding has `severity: blocker`.

### Regression fixture

A small integration test feeds a known-bad screenshot (the historical
empty-canvas regression captured pre-0015-01) + a representative AC
list, and asserts the critic returns a `severity: blocker` finding
referencing a missing user boat / empty canvas. The fixture
screenshot can be (a) captured by checking out the pre-0015-01 code
and running the app, or (b) hand-crafted as a synthetic mostly-black
PNG. Pick one; document the choice in the test.

## Acceptance criteria

- [ ] Sub-agent definition exists under the project's agent-definition root, discoverable via the same mechanism as existing sub-agents.
- [ ] Sub-agent accepts the input shape above (JSON file or stdin).
- [ ] Sub-agent returns the output shape above on stdout.
- [ ] Sub-agent exits non-zero iff any finding is `severity: blocker`.
- [ ] Regression test feeds a known-bad screenshot + AC list and asserts a `severity: blocker` finding is returned with a non-zero exit code.
- [ ] Sub-agent prompt is centralised in the definition file (not duplicated across calling agents).

## Blocked by

None — can start immediately.
