# Architecture specs

Cross-cutting design for internal subsystems that is too large for a single
ADR and too internal to be an INT spec.

An ARCH spec is the home for:

- End-to-end data flow inside a process
- Package/module layout and dependency rules
- Stage contracts (inputs, outputs, failure modes)
- Diagrams that span multiple ADRs

ADRs remain the home for individual decisions (context → options → decision →
consequences); an ARCH spec composes accepted ADRs into a single coherent
picture and fills in the glue the ADRs don't cover.

| ID        | Title                       | Status   |
|-----------|-----------------------------|----------|
| ARCH-0001 | Backend Pipeline (M1–M3)    | Draft    |

See [`template.md`](template.md) to add a new ARCH spec.

## Status lifecycle

Same as ADRs: `Draft` → `Proposed` → `Accepted` → (`Superseded by XXXX` |
`Deprecated`). Substantive changes to an accepted ARCH spec need a
superseding spec.
