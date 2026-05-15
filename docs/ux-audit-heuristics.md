# UX audit — heuristic checklist

Canonical source of truth for the critique pass over Playwright
captures. Both the findings docs (`docs/ux-audit-*-findings.md`) and
the capture specs (`web/tests/e2e/ux-audit/*.spec.ts`) reference this
file rather than embedding their own copy.

The list mixes Nielsen-derived basics with rower-domain heuristics
discovered during the manual audit.

## Behavioural / domain heuristics

1. **Label coherence across transitions** — does the label the user
   just tapped survive into the next screen? (e.g. HM-label drift
   Step2 → Confirm — F3.)
2. **CTA verbs match user intent** — primary action labelled as what
   the user actually wants, not what the system wants to offer them.
   ("Row again?" class — U4.)
3. **No rhetorical subtitles** — the screen states what it is, doesn't
   ask the user if they're "ready".
4. **State legibility** — loading, empty, error, populated are
   visually distinct; empty states give the user a *next step*, not a
   dead end. (F5, F9.)
5. **Live values don't lie** — visible numbers update at the cadence
   the user expects. (Bumpy timer — U1/U2.)
6. **Affordance honesty** — buttons do what their label says. ("Start
   new session" that actually navigates home — U4.)
7. **Cross-mode consistency** — same domain concept presented
   identically across modes. (distance vs race preset labels — F4.)
8. **No silent state loss** — going back doesn't drop user input
   without warning. (C3, F7.)
9. **Bounds + guardrails** — steppers, inputs, distance choices have
   sane max/min so the UI never offers physically-nonsense states.
   (C2 — Eigene unbounded; F6 — no disabled cue.)
10. **Reading order matches priority** — the first thing visible is
    the thing the user came for. (F10 — All-out clipped below fold.)

## Layout / responsive heuristics

Captured at screenshot time by `layout-audit.ts` (sidecar JSON next to
each PNG); critique pass reads PNG + JSON together.

11. **Overlapping UI elements** — pairs of visible, non-ancestor
    elements whose bounding boxes intersect (and which aren't an
    intentional modal/popover stack) indicate broken stacking or
    miscomputed layout.
12. **Broken responsive layout** — any element whose right edge
    extends past the viewport width, or a document scroll width
    exceeding viewport width, means content escapes the screen on the
    target form factor.
13. **Uneven whitespace distribution** — outsized vertical gaps
    between top-level sections (≥ 3× the median or median + 32 px)
    suggest either accidental empty space or content that's missing.

## How to apply

For each capture, walk through items 1–10 against the rendered PNG and
items 11–13 against the sidecar JSON. Findings are recorded in the
flow's findings doc (`docs/ux-audit-<flow>-findings.md`) and tracked
as tasks (`F1`, `F2`, …).
