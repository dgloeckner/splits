# GitHub Copilot instructions

See [`../AGENTS.md`](../AGENTS.md) for the full working context.

Short version for inline completions:

- Spec before code (FEAT / INT / ADR pattern, see `specs/`).
- Minimal dependencies. Justify any new library.
- German domain vocabulary stays German (see `docs/domain-glossary.md`),
  code identifiers are English.
- LAN-first, self-hosted. No telemetry, no external runtime calls.
- Don't invent IPM protocol details — update `specs/int/0001-ipm-serial-protocol.md`
  when reality diverges.
