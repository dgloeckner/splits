<img src="splits-logo.svg" alt="splits" height="48" />

**Your rowing machine, your data, your house.**

splits turns a water rower into a live training display on any phone,
tablet or laptop in the room, and keeps every stroke you've ever pulled.
It's a self-hosted PWA, so there's no app store, no sign-up and no cloud.

## Why

The Row GX ships with a console that shows numbers for the current workout
and then forgets them. The vendor's companion software, FirstCoach, runs
only on Windows. splits reads the console's USB port directly and gives you:

- **Live numbers on your phone.** Split, stroke rate, watts and distance
  update stroke by stroke while you row.
- **A history that stays.** Every session is stored and broken down per
  rower, so you can see trends over weeks and months.
- **Goals** (next up, [M5](ROADMAP.md)). Set a target and see how you're
  tracking against it.

## Privacy by design

splits runs on a small box in your home, behind your home router's
firewall. Your workouts never leave your network.

- **No cloud, ever.** Cloud sync isn't on the roadmap.
- **No telemetry**, no third-party calls and no CDNs at runtime.
- **Works offline.** The installed PWA keeps your stats readable in
  airplane mode.

## Hardware

| Part | What it is | Official specs |
|------|------------|----------------|
| **Ergometer** | Life Fitness Row GX Trainer: water ("Fluid Technology") resistance, 16 levels, 150 kg max user | [Life Fitness spec sheet (PDF)](https://www.lifefitness.com.au/wp-content/uploads/2016/01/PM-024-15-ROW-GX-Sell-Sheet-vf.pdf) |
| **Console** | First Degree Fitness IPM (the Row GX is FDF-built), micro-USB on the underside | [First Degree Fitness](https://www.firstdegreefitness.com/) |
| **USB bridge** | FTDI FT232R USB-to-serial chip, `0403:6001`, 9600 baud 8N1 | [FTDI FT232R](https://ftdichip.com/products/ft232rl/) |
| **Host** | Raspberry Pi Zero 2 W or any Pi 3/4/5, x86-64 Linux box, Mac or Windows PC | [Raspberry Pi Zero 2 W](https://www.raspberrypi.com/products/raspberry-pi-zero-2-w/) |

The console's serial protocol isn't published, so we reverse-engineered
it from captured sessions. The handshake and the live `A8` stroke stream
are fully decoded in
[INT-0001](specs/int/0001-ipm-serial-protocol.md).

<p align="center">
  <img src="docs/visualizations/01-power-all-sessions.png" alt="Power output over time across five captured sessions" width="720" />
  <br />
  <sub>Power curves decoded from real captures. More charts are in <a href="docs/visualizations/">docs/visualizations/</a>.</sub>
</p>

## Install

1. Download the tarball for your board from
   [Releases](https://github.com/dgloeckner/splits/releases). `v*` tags
   are stable releases and `nightly` tracks `main`.
2. Plug the rower's console into the host via USB.
3. Follow [`deploy/README.md`](deploy/README.md).

Each tarball bundles a static Go binary, the PWA and a systemd installer.

**Set and forget.** A Pi installed from a tagged release updates itself
overnight. It never updates while someone is rowing, and it rolls back on
its own if the new version doesn't come up. See
[Unattended updates](deploy/README.md#unattended-updates).

## Goals (v1)

- Real-time live display during workouts via PWA
- Multi-user with simple auth
- Indefinite session history with per-user statistics
- Training goals
- Installable without an app store
- Runs on Mac, Windows, or a Raspberry Pi

## Non-goals (v1)

- Cloud sync
- Public leaderboards / social features

## Under the hood

Go backend and React (Vite, TS) frontend
([ADR-0003](specs/adr/0003-tech-stack-go-react.md)). Caddy terminates TLS,
serves the built PWA and proxies `/api` to the backend.

```mermaid
flowchart TB
    subgraph rower["Rowing machine"]
        IPM["IPM console<br/>USB serial, 9600 8N1"]
    end

    subgraph host["Host: Pi / Mac / PC"]
        PROD["producer<br/>serial reader + parser"]
        SES["sessionizer<br/>sessions, metrics, ids"]
        DISP["dispatcher<br/>fan-out"]
        RING["ring buffer<br/>reconnect replay"]
        PERS["persister"]
        DB[("SQLite")]
        BC["SSE broadcaster"]
        API["HTTP API<br/>/api/v1"]
        CADDY["Caddy<br/>TLS + PWA assets"]

        PROD -- "ipm.Frame" --> SES
        SES -- "event.Event" --> DISP
        DISP --> RING
        DISP -- "never drops" --> PERS
        DISP --> BC
        PERS --> DB
        DB --> API
        RING --> API
        BC --> API
        API --> CADDY
    end

    subgraph devices["Phones, tablets, laptops"]
        PWA["PWA<br/>live view, history, stats"]
        IDB[("Service worker cache<br/>+ IndexedDB")]
        PWA <--> IDB
    end

    IPM -- "A8 stroke stream" --> PROD
    CADDY -- "HTTPS + SSE (LAN)" --> PWA
```

Every stroke takes one path from the console's serial port to SQLite. The
live view reads the same events over Server-Sent Events, so what you saw
while rowing is what gets stored
([ADR-0007](specs/adr/0007-event-ingestion-pipeline.md),
[ARCH-0001](specs/arch/0001-backend-pipeline.md)). The PWA caches history
on the device, so it still works offline
([ADR-0018](specs/adr/0018-offline-as-packed-snapshot.md)).

- 🤖 [`AGENTS.md`](AGENTS.md): start here as a contributor, human or AI
- 🗺️ [`ROADMAP.md`](ROADMAP.md): milestones
- 📋 [`specs/`](specs/): FEAT / INT / ADR specifications
- 📖 [`docs/domain-glossary.md`](docs/domain-glossary.md): rowing vocabulary
- 🧪 [`traces/`](traces/): probe scripts and the Python reference parser

## License

Apache License 2.0, see [`LICENSE`](LICENSE).
