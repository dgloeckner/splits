# ADR-0004: Local-First Persistence

- **Status**: Accepted
- **Date**: 2026-04-19

## Context

User data (profiles, sessions, goals) needs a home. Options range from "all
on the user's device" (browser storage) to "everything in the cloud"
(hosted database).

Constraints:
- No mandatory external dependencies at runtime
- Works fully inside a LAN
- Multi-user implies a shared source of truth
- Backup should be trivial

## Options considered

### Option A — Backend-local SQLite file

Single file on the deploy host. All clients are thin — they read/write via
the backend API.

Pros: Single source of truth; trivial backup (copy one file); transactional
consistency; works offline for the backend; mature tooling.

Cons: Clients need the backend to be reachable for any non-cached view.

### Option B — Browser IndexedDB per client + eventual sync

Pros: Offline-first clients; works without a running backend.

Cons: Sync / conflict resolution is a significant engineering effort; no
single source of truth; multi-user gets complicated fast. Overkill for a
household.

### Option C — Hosted database (Postgres / Supabase / Firebase)

Pros: Managed, scalable, backed up.

Cons: External runtime dependency; costs money or accepts vendor lock-in;
privacy concerns; internet outage breaks the app; contradicts the
"self-hosted LAN-first" principle.

## Decision

**Option A — Backend-local SQLite.** One file on the deploy host, accessed
only by the backend process.

## Consequences

- Backup = cron job that `.backup`s the DB file to another location
  (NAS, USB stick, or a separate Pi partition).
- Export = the same mechanism; user can request a download of their data
  from the UI.
- Migrations = SQL files in `backend/migrations/`, applied at startup by
  the backend.
- The PWA caches past session views opportunistically via its service
  worker (see FEAT-0006) — but the canonical store is always the server's
  SQLite file.
- If Option B (offline-first clients) becomes desirable later, this ADR
  can be superseded — but we pay that complexity cost only once it's
  actually wanted.
