---
name: ux-heuristic-audit
description: Run the Playwright UX capture spec for a flow, then apply the 13-item heuristic checklist (docs/ux-audit-heuristics.md) over the captured PNGs and layout JSON sidecars. Produces a findings doc and opens one task per finding. Use when the user asks for a UX/visual audit of a workout flow or a UI surface.
---

<what-to-do>

You are running a UX audit for a flow the user named (default: distance).
Goal: produce a written findings list against the canonical 13-item
heuristic checklist, opened as discrete tasks for follow-up.

## Workflow

1. **Identify the flow and spec.** The user names a flow (e.g.
   "distance", "race"). The corresponding capture spec is
   `web/tests/e2e/ux-audit/<flow>-capture.spec.ts`. If it doesn't
   exist, stop and tell the user — building a new capture spec is a
   bigger task with its own grilling pass; do not silently create one.

2. **Read the canonical heuristics.** Open
   `docs/ux-audit-heuristics.md` and load all 13 items into your
   working memory. Do not paraphrase the list back to the user —
   they've read it. Items 1–10 are behavioural/domain (apply against
   PNG screenshots); items 11–13 are layout (apply against the JSON
   sidecars).

3. **Run the capture spec.** From the `web/` directory:

   ```
   PLAYWRIGHT_BASE_URL=noop npx playwright test \
     tests/e2e/ux-audit/<flow>-capture.spec.ts --reporter=line
   ```

   On failure: stop and surface the error. Don't try to fix the spec
   without asking — the capture infrastructure is the foundation;
   silent edits there compound.

4. **Discover the artifacts.** Captures land in
   `test-results/ux-audit/<flow>/{phone,tablet}/*.{png,layout.json}`.
   Each PNG has a sidecar JSON of the same basename.

5. **Apply the heuristics, screen by screen.** For each captured
   state:

   - **Read the per-state intent.** Open the capture spec at
     `web/tests/e2e/ux-audit/<flow>-capture.spec.ts` once and use the
     comment immediately above each `snap('<state>')` call as the
     intent for that capture. The spec has one-liners like
     `// 7. Step 3 → Confirm (5 km preset, moderat intensity).` —
     those are your expectation when reading the PNG. Walking the
     PNG without the intent is what missed F11 the first time.
   - **Read the PNG.** Use the `Read` tool — it renders the image.
   - **Read the sidecar JSON.** Walk items 1–10 against the visual.
     Items 11–13 (overflow / overlap / whitespace) and the five
     mechanical sensors (`wrap`, `ellipsis`, `clipping`, `tapTarget`,
     `belowFold`) come from the JSON.
   - **Contract — every non-empty sensor array MUST be addressed in
     the findings doc.** Either open an `F<n>` item for it, or
     include an explicit `Dropped as false positive: <reason>` line
     in the writeup. No silent skips. The contract applies to all
     eight sensor arrays. A non-empty array is not automatically a
     bug — but it cannot be ignored without an explicit decision.

6. **Compare phone vs tablet.** A finding that appears on one
   viewport and not the other is itself a finding (broken
   responsive). Walk the tablet captures and call out divergences.

7. **Write the findings doc** at
   `docs/ux-audit-<flow>-findings.md` (overwrite if it exists). Use
   the format below. Reference the canonical heuristics by number.

8. **Open one task per finding.** Use `TaskCreate`. Subject:
   `F<n> — <one-line summary>`. Description: which heuristic it
   violates, where it appears (capture path, viewport), and the
   suggested fix direction. Use the same `F<n>` numbering in the doc.

9. **Surface a summary** to the user: how many findings opened, which
   heuristic categories they cluster around, which captures had zero
   issues. Don't restate the heuristics list — point at the
   `docs/ux-audit-<flow>-findings.md` file.

## Stop-the-line cases

- The capture spec doesn't exist → ask the user before building one.
- The capture spec fails → surface the failure, don't silently retry.
- A finding seems load-bearing on user-level domain semantics
  (renaming a German rowing term, changing what a CTA does) → flag
  for confirmation rather than just opening a task.
- A sidecar JSON reports overlaps in tens or hundreds → likely a
  false-positive cluster (e.g. a flex row of small chips registering
  pairwise overlaps with their text spans). Drop the spurious ones in
  the writeup rather than opening a task per row.

## What to skip

- Don't propose fixes for findings in this pass — only write them up.
  Fixes are a separate user decision; some findings turn out to be
  "not a bug" once we look at the domain.
- Don't run unrelated test suites or rebuild artifacts.
- Don't restructure the heuristic checklist. If a new pattern emerges
  that doesn't fit, propose adding a 14th item to
  `docs/ux-audit-heuristics.md` as a discrete suggestion to the user.

</what-to-do>

<supporting-info>

## Findings doc format

```markdown
# UX/visual audit — <flow> flow

Method: Playwright drove the <flow> flow through <N> captured states ×
2 viewports (phone 390×844, tablet 820×1180). Captures and layout JSON
sidecars under `test-results/ux-audit/<flow>/{phone,tablet}/`.
Heuristic checklist: `docs/ux-audit-heuristics.md`.

## What's clean

- Items that the captures explicitly verify (e.g. "HM/Marathon labels
  survive Step2 → Confirm — F3-class regressions absent").

## Findings

### F1 — <one-line summary>

- **Where:** `<capture path>` (phone | tablet | both)
- **Heuristic violated:** #<n> — <name> (or "sensor:<name>")
- **Observation:** <what is wrong>
- **Suggested fix:** <direction; one or two sentences>

### F2 — …

## Sensor false positives (per contract — every non-empty array
## must be addressed; entries here are the explicit drops)

- **`tapTarget` on `<flow-back>` (26×28 px):** Dropped — element has
  a 12-px transparent padding ring that extends the hit area to
  50×52 px. The sensor measures the visible bbox only.
- **`tapTarget` on `<input type="checkbox">` (18×18 px):** Dropped —
  enclosing `<label>` is 280×44 px; tapping anywhere on the label
  toggles the checkbox. (Already handled by the sensor; recorded
  here only when a stray slip-through occurs.)
```

## Heuristic application notes

- **Item 5 (live values don't lie)** can't be fully verified from a
  static screenshot. Use it to flag candidates only when a still
  capture shows a "stale" tile (e.g. all values "—" while the page
  claims it's mid-session).
- **Item 8 (no silent state loss)** also rarely shows in a single
  capture. Use it when you see two captures of the "same" screen at
  different points in the flow that diverge in committed state.
- **Item 11 (overlapping UI elements)** in the JSON often surfaces
  intentional cases (a chip's text span overlapping its button bbox).
  Filter for cross-section overlaps — different components rendered
  on top of each other.
- **Item 13 (uneven whitespace)** has a threshold in the layout
  audit. Trust the report's `gapPx` vs `medianPx` — if a gap is
  flagged, it really is the largest gap on the page.

## Sensor reference

`layout-audit.ts` emits eight sensor arrays. The first three are the
named heuristics 11–13; the next five are mechanical probes whose
findings the audit AI judges screen-by-screen.

- **`overflow`** — element right-edge past viewport width.
- **`overlap`** — non-ancestor visible elements whose bboxes intersect.
- **`whitespace`** — outsized vertical gaps between top-level sections.
- **`wrap`** — short labels (≤ 40 chars) inside button/label/heading/
  chip-style containers rendering on > 1 line. Catches mid-word breaks
  (F11). Almost always a real bug — only drop as false positive when
  the multi-line break is the intended design.
- **`ellipsis`** — `text-overflow: ellipsis` nodes whose `scrollWidth`
  exceeds `clientWidth`. Real labels truncated to "…".
- **`clipping`** — text whose bbox extends past the nearest
  `overflow: hidden`/`clip` ancestor. Catches "10 km" bleeding into a
  neighbour cell.
- **`tapTarget`** — interactive elements smaller than 44×44 px on
  phone viewport. Often legitimate when small chips are surrounded by
  generous padding; assess per case. Native `<input>` elements
  wrapped in `<label>` are measured at the label boundary, not the
  input itself.
- **`belowFold`** — interactive elements whose bbox top is below the
  captured viewport bottom. Always-real on phones; may be intended on
  scrolling-by-design surfaces (list views).

## Existing artifacts to reference

- `docs/ux-audit-heuristics.md` — canonical 13-item checklist
- `web/tests/e2e/ux-audit/layout-audit.ts` — sidecar generator
- `docs/ux-audit-distance-findings.md` — pilot output, shows the
  expected shape of the writeup

</supporting-info>
