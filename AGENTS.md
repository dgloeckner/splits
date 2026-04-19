# AGENTS.md

Primary instructions for any AI coding agent (Claude Code, GitHub Copilot, Codex
CLI, Cursor, …) working on this repository.

## Project

**home-ergo** — a self-hosted PWA for capturing, visualising and archiving
rowing-ergometer sessions from a **Life Fitness Row GX Trainer** (OEM: First
Degree Fitness IPM console) in a household setting.

Project name is a placeholder; rename before first publish.

### Mission

Replace the vendor's Windows-only "FirstCoach" software with a lightweight,
cross-platform, mobile-friendly alternative that:

- runs on commodity home hardware (Mac, Windows PC, Raspberry Pi, …)
- serves a Progressive Web App — **installable without any app store**
- supports multiple household users with trivial onboarding
- persists every session locally, indefinitely
- shows live training data in real time during the workout
- derives statistics and tracks user-defined training goals

Explicitly **not** a goal (yet): cloud sync, social features, public leaderboards,
FRGS-wide club deployment. The design should not preclude those, but they are
out of scope for v1.

## Confirmed requirements

| # | Requirement                          | Spec                          |
|---|--------------------------------------|-------------------------------|
| 1 | Live display in a PWA                | FEAT-0001                     |
| 2 | Deployable on Mac / Windows / Pi     | ADR-0001                      |
| 3 | Lightweight backend, robust storage  | ADR-0003, ADR-0004            |
| 4 | Multi-user with shared-secret auth   | FEAT-0002, ADR-0005           |
| 5 | Indefinite session history           | FEAT-0003                     |
| 6 | Per-user statistics                  | FEAT-0004                     |
| 7 | Training goals                       | FEAT-0005                     |

## Open decisions (require ADR before implementation)

- **Backend language / framework** — candidates: Go, Python (FastAPI),
  Kotlin/Ktor, Node. See ADR-0003.
- **Frontend framework** — candidates: Angular, SvelteKit, Vite+Preact. See
  ADR-0003.
- **Persistence** — SQLite strongly favoured; decide via ADR once backend
  language is chosen (driver choice matters for cross-compile to ARM).
- **TLS strategy** — Caddy + Let's Encrypt via DNS-01 (public DNS resolves to
  private IP) vs Caddy internal CA. See ADR-0006 (to be written).
- **Session boundary detection** — idle timeout vs explicit start/stop in UI vs
  protocol-level signals from the console. See INT-0001.

## Spec-driven development

This repository follows the FEAT / INT / ADR pattern. Before writing code that
introduces a new capability, external integration, or architectural commitment,
**write the spec first** and open a PR for the spec alone.

- **FEAT-XXXX** — user-facing feature. Lives in `specs/feat/`. Describes user
  stories, acceptance criteria, UI sketches, non-goals.
- **INT-XXXX** — integration with an external system, protocol or API. Lives in
  `specs/int/`. Describes wire format, state machines, error handling, test
  fixtures.
- **ADR-XXXX** — architectural decision. Lives in `specs/adr/`. Short. Context
  → Options → Decision → Consequences. Supersedable, not editable after
  acceptance.

Templates are in each directory.

## Working conventions for agents

1. **Spec before code.** If the task has no matching FEAT/INT/ADR, propose one
   first. Small bug fixes and refactors are exempt.
2. **Small diffs.** One concern per PR. If you're touching more than ~300 lines
   across unrelated files, stop and re-scope.
3. **Minimal dependencies.** Prefer the standard library and one well-maintained
   third-party library over a framework that pulls 200 transitive deps. Justify
   any new dependency in the PR description.
4. **Tests matter, not test counts.** Focus tests on the protocol parser, the
   session state machine, and statistics calculations. Skip trivial
   getter/setter tests. TDD is encouraged for the parser (it is pure logic with
   fixture inputs).
5. **German domain vocabulary stays German.** See `docs/domain-glossary.md`.
   Code identifiers are English (`Session`, `Stroke`, `Split`), but user-facing
   strings can be German or i18n'd.
6. **ARMv6 compatibility matters** if Pi Zero (non-2W) is still on the table —
   check compile targets before picking a language. Pi Zero 2W is ARMv7/v8 and
   has no such constraint.
7. **Self-hosted, LAN-first.** No telemetry, no external API calls at runtime,
   no CDN dependencies that break offline. PWA must work with the device in
   airplane mode after first load.
8. **Don't invent protocol details.** The IPM serial protocol is documented in
   INT-0001 based on community reverse-engineering. If reality diverges from
   the spec during testing, **update the spec** in the same PR as the code.

## Layout (once tech stack is chosen)

```
home-ergo/
├── AGENTS.md
├── README.md
├── specs/
│   ├── adr/              # Architectural Decision Records
│   ├── feat/             # Feature specs
│   └── int/              # Integration specs (external protocols)
├── docs/
│   ├── domain-glossary.md
│   └── protocol-notes.md # Raw notes from protocol reverse engineering
├── backend/              # TBD — lives here once ADR-0003 resolves
├── web/                  # PWA frontend — TBD
└── deploy/               # systemd units, Caddyfile, install scripts
```

## Hardware context

- **Target ergo**: Life Fitness Row GX Trainer (water-resistance, FDF OEM)
- **Console**: First Degree Fitness IPM — exposes a USB-CDC virtual serial
  port (micro-USB, bottom of monitor; visible in `docs/protocol-notes.md`)
- **Protocol**: 9600 baud, ASCII, line-based, command/response + continuous
  stream during rowing. Documented in INT-0001.
- **Target deploy host (preferred)**: Raspberry Pi Zero 2 W, but stack must
  also run on a developer Mac for local development and on a Windows PC for
  the non-technical household scenario.

## Pointers

- Spec templates: `specs/*/template.md`
- Domain glossary: `docs/domain-glossary.md`
- Protocol notes: `docs/protocol-notes.md`
- Roadmap: `ROADMAP.md`
