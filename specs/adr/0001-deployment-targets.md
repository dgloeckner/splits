# ADR-0001: Deployment Targets

- **Status**: Accepted
- **Date**: 2026-04-19

## Context

The app needs to run somewhere in the household that is always-on (for
session capture to work reliably without a laptop being open). Candidates
differ significantly in constraints (CPU, RAM, architecture, OS, runtime
availability).

## Options considered

### Option A — Raspberry Pi (Zero 2 W or similar SBC)

Pros: Always-on, low power (~2 W), cheap, can sit next to the ergo, WLAN
built-in, full Linux userspace.

Cons: ARMv6 (Pi Zero) or ARMv7 (Zero 2 W) — restricts runtime choices;
limited RAM (512 MB on Zero); SD card wear matters.

### Option B — Developer Mac

Pros: Powerful, comfortable to develop on, already present.

Cons: Not always on, closes the lid, goes on trips. Not a production
deployment target.

### Option C — Windows PC

Pros: Common in German households, often always-on for media / other uses.

Cons: Serial-port drivers can be finicky; less familiar territory for the
maintainer; Windows service management less pleasant than systemd.

### Option D — Docker on NAS / home server

Pros: Already running, reliable storage, backups sorted.

Cons: Serial-USB passthrough to containers gets gnarly; requires a NAS,
not a given in every household.

## Decision

**Support all three "personal compute" targets as first-class deployment
platforms: Mac, Windows PC, Raspberry Pi.** Preferred deployment is a
Raspberry Pi (any model with WLAN).

Pi Zero (ARMv6) support is "nice to have" but **not a hard requirement** —
Pi Zero 2 W (ARMv7) is the realistic minimum, Pi 3/4/5 are trivially
supported.

## Consequences

- Tech stack choice (ADR-0003) must compile to, or run on, all three OSes
  and on ARMv7+. This rules out runtimes without mature ARM Linux support.
- Deployment artefacts should be either (a) a single static binary + a
  static web bundle, or (b) a small container image. Avoid per-OS
  installers.
- Serial port handling must abstract over `/dev/tty*` (macOS/Linux) and
  `COMx` (Windows).
- Automated tests should run in CI on Linux x86_64 with the protocol
  adapter mocked; hardware-in-the-loop tests stay manual.
