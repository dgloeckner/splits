# Specs

Three flavours of specification.

## FEAT — Feature specs → [`feat/`](feat/)

What a user can do. User stories, acceptance criteria, UI sketches, non-goals.
Owned by product thinking, consumed by implementers.

## INT — Integration specs → [`int/`](int/)

How we talk to an external system. Wire format, state machines, error handling,
test fixtures. Covers protocols, APIs, file formats, hardware interfaces.

## ADR — Architecture Decision Records → [`adr/`](adr/)

Why we chose X over Y. Context → Options → Decision → Consequences. Short and
immutable after acceptance — if the decision changes later, write a new ADR
that supersedes the old one rather than editing history.

## ARCH — Architecture specs → [`arch/`](arch/)

How a subsystem is shaped end-to-end. Cross-cutting design that is too large
for a single ADR and too internal to be an INT spec: package layout, stage
contracts, data flow diagrams, per-component failure modes. An ARCH spec
composes accepted ADRs into a coherent picture and fills in the glue between
them.

## Numbering

Four-digit zero-padded, sequential per type. Gaps are allowed if a spec is
withdrawn before acceptance. Never reuse numbers.

## Status lifecycle

`Draft` → `Proposed` → `Accepted` → (`Superseded by XXXX` | `Deprecated`)

A Draft may be edited freely. Once `Proposed`, changes go through PR review.
Once `Accepted`, only clarifying edits; substantive changes need a superseding
spec.
