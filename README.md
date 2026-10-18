<img src="splits-logo.svg" alt="splits" height="48" />

Self-hosted PWA for rowing ergometer session tracking.

Hardware target: Life Fitness Row GX Trainer (First Degree Fitness IPM
console, USB-serial).

## Status

🚧 **Early scaffolding.** Tech stack: **Go backend + React (Vite, TS)
frontend**, single embedded static binary — see
[`specs/adr/0003-tech-stack-go-react.md`](specs/adr/0003-tech-stack-go-react.md).

M0 (protocol verification) is essentially done: the IPM serial handshake
and the live-data `A8` message stream are decoded and documented in
[`specs/int/0001-ipm-serial-protocol.md`](specs/int/0001-ipm-serial-protocol.md).
Reference parser lives at [`traces/ipm_parser.py`](traces/ipm_parser.py);
sample session captures and decoded CSVs are under
[`specs/int/fixtures/ipm/`](specs/int/fixtures/ipm/). Session
visualisations under [`docs/visualizations/`](docs/visualizations/).

## Install

Download the tarball for your board from the
[Releases page](https://github.com/dgloeckner/splits/releases)
(`v*` tags; `nightly` tracks `main`) and follow
[`deploy/README.md`](deploy/README.md). Each tarball bundles the static
backend binary, the PWA, and the installer for a Raspberry Pi or any
systemd Linux host. CI (`.github/workflows/`) tests every change and
builds the packages — see
[`specs/adr/0022-ci-and-release-packaging.md`](specs/adr/0022-ci-and-release-packaging.md).

## Quick pointers

- 🤖 [`AGENTS.md`](AGENTS.md) — start here if you're an AI agent or a human
  contributor
- 🗺️ [`ROADMAP.md`](ROADMAP.md) — milestones
- 📋 [`specs/`](specs/) — FEAT / INT / ADR specifications
- 📖 [`docs/domain-glossary.md`](docs/domain-glossary.md) — rowing vocabulary
- 🔌 [`specs/int/0001-ipm-serial-protocol.md`](specs/int/0001-ipm-serial-protocol.md)
  — canonical IPM wire-format spec
- 🧪 [`traces/`](traces/) — probe scripts (`probe_handshake.py`,
  `probe_session.py`), reference parser (`ipm_parser.py`), session
  visualisations generator (`visualize_sessions.py`)
- 📈 [`docs/visualizations/`](docs/visualizations/) — rendered charts from
  the captured sessions

## Goals (v1)

- Real-time live display during workouts via PWA
- Multi-user with shared-secret LAN auth
- Indefinite session history with per-user statistics
- Training goals
- Installable without an app store
- Runs on Mac, Windows, or a Raspberry Pi

## Non-goals (v1)

- Cloud sync
- Public leaderboards / social features
- Club-wide deployment (FRGS or otherwise)
- Native mobile apps

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
