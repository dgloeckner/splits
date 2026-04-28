# backend — Home Ergo backend

Go service that reads the FDF IPM serial console, derives per-stroke metrics, broadcasts a Server-Sent-Events stream, and persists sessions to SQLite.

## Run against a fixture (no hardware needed)

```bash
cd backend
SPLITS_FIXTURE=../specs/int/fixtures/ipm/session-short.csv \
SPLITS_FIXTURE_RATE=realtime \
SPLITS_DB_PATH=./dev.db \
go run ./cmd/splits
```

- `realtime` pacing honours the original inter-stroke timing (~0.5 Hz).
- Use `fast` pacing for tight dev loops.

The PWA at `http://localhost:5173/` proxies `/api/*` to `http://localhost:8080/`, so start the fixture first and then `npm run dev` in `../web/`.

## Run against the real IPM console

```bash
cd backend
SPLITS_SERIAL_PORT=/dev/cu.usbserial-AB0JKG07 go run ./cmd/splits
```

If the port is left unset the backend auto-detects the FTDI `0403:6001` (see INT-0001).

## Tests

```bash
go test ./...
```

The e2e smoke in `cmd/splits/main_sse_test.go` boots a real server against a fixture and asserts the SSE stream shape.

## Config

| Env var                     | Default                   | Purpose                                         |
|-----------------------------|---------------------------|-------------------------------------------------|
| `SPLITS_ADDR`               | `:8080`                   | HTTP listen address                             |
| `SPLITS_SERIAL_PORT`        | auto-detect FTDI          | Override for non-FTDI / multi-device            |
| `SPLITS_SERIAL_BAUD`        | `9600`                    | Per INT-0001                                    |
| `SPLITS_DB_PATH`            | `./splits.db`             | SQLite file                                     |
| `SPLITS_FIXTURE`            | unset                     | CSV / bin fixture in place of serial            |
| `SPLITS_FIXTURE_RATE`       | `realtime`                | `realtime` or `fast` pacing                     |
| `SPLITS_LOG_LEVEL`          | `info`                    | `debug` / `info` / `warn` / `error`             |
| `SPLITS_IDLE_TIMEOUT`       | `60s`                     | Stroke gap that closes a session                |
| `SPLITS_DEV_MODE`           | unset                     | `1` enables dev-only endpoints                  |

### Legacy env vars

The brand was renamed from "homeergo" to "splits". For one release the
backend still accepts the old `HOMEERGO_*` names as a fallback when the
matching `SPLITS_*` is unset. If only `./homeergo.db` exists (and
`SPLITS_DB_PATH` is not set), the backend opens it and logs a warning
advising a rename to `./splits.db`. Plan to migrate before the next
release; the fallback will be removed.

## HTTP API

| Method | Path                                 | Purpose                                     |
|--------|--------------------------------------|---------------------------------------------|
| GET    | `/api/health`                        | Liveness                                    |
| GET    | `/api/v1/stream`                     | SSE live stream (INT-0002)                  |
| GET    | `/api/v1/sessions?limit=&offset=`    | List non-deleted sessions, newest first     |
| GET    | `/api/v1/sessions/{id}`              | Detail (summary + totals)                   |
| GET    | `/api/v1/sessions/{id}/samples`      | Per-stroke series for charts                |
| DELETE | `/api/v1/sessions/{id}`              | Soft-delete                                 |
| GET    | `/debug/ingest`                      | Pipeline health (LAN-only, unauthed in v1)  |

## Debugging

`GET /debug/ingest` returns pipeline health JSON (LAN-only; no auth in v1).

## Pairing & rower management

Per-rower pairing per `docs/superpowers/specs/2026-04-28-feat-0002-pairing-design.md`. Trust model is flat (no admin tier): every paired rower can mint pairing URLs for new rowers / new devices.

### CLI subcommands

All commands run on the backend host with the same env (`SPLITS_DB_PATH`, etc.) as the running service. SQLite WAL mode allows the CLI to run while the server is up.

| Command | Purpose |
|---|---|
| `splits invite <rower-id>` | Print pairing URL for that rower (24h expiry, single use). |
| `splits revoke <rower-id>` | Delete all device pairings + outstanding tokens for that rower. Forces re-pair. |
| `splits delete-rower <rower-id>` | Soft-delete rower; pairings + tokens removed. |
| `splits ls-rowers` | List rowers (read-only). |
| `splits ls-pairings` | List `device_rowers` rows (read-only). |
| `splits ls-tokens` | List outstanding pairing tokens (read-only). |

### Common scenarios

**First install** — open the deployed URL on whichever device should be the founder; "Welcome — create first rower" form auto-pairs that device. No CLI needed.

**Adding another rower** — on any paired device: Profile tab → `+` → "Pairing-Link für ein anderes Gerät erstellen" → pick rower (or first create them) → send the URL via Signal/AirDrop/SMS. Receiver opens the URL on their device → paired.

**Adding existing rower to a new device (your second device)** — same flow as above, picking yourself. Or use `splits invite <your-rower-id>` and open the URL on the second device.

**Lost device, household has another paired device** — optionally `splits revoke <rower-id>` on the host (invalidates all of that rower's existing device pairings, recommended if theft suspected). Then mint a fresh pairing link from any other paired device → open URL on replacement device.

**Lost device, single-rower install (no other paired device)** — SSH to the host: `splits invite <rower-id>` prints URL → send to yourself out-of-band → open on new device.

**Removing a household member** — `splits delete-rower <rower-id>` on the host. Soft-deletes the rower (sessions remain attributed) and removes all their device pairings + outstanding tokens.

**Rotating a rower's pairing for any reason** — `splits revoke <rower-id>` then `splits invite <rower-id>`; share the new URL with the legitimate owner who re-pairs each of their devices.

### Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| New device shows "Code abgelaufen" on `/pair` | Token > 24h old or already consumed | Mint a fresh URL via Profile or `splits invite`. |
| Mint button returns 403 | Active device is not paired with that rower | Use a device that IS paired, or use `splits invite`. |
| `splits invite` prints `rower not found` | Rower id wrong or rower soft-deleted | `splits ls-rowers` to confirm. |
| TLS error on first deploy | Caddy cert not yet provisioned | Check Caddy logs; DNS-01 may take 1-5 min on first issue. |
| Backend refuses to start | T10 gate hit (no TLS, no dev mode) | Set `SPLITS_TLS_TERMINATED_BY=proxy` if behind Caddy, or `SPLITS_DEV_MODE=1` for local dev. |

### What we explicitly do NOT support

- A fresh unpaired device cannot claim an existing rower from the UI without a token. Use the CLI invite path instead. This is intentional: otherwise any LAN visitor could take over a rower whose last device died.
- No in-app camera scanner. The pairing URL works either pasted directly or via the phone's native QR-code scanner / camera app.
- No admin tier. Any paired rower can create pairing links for any rower.

See the design doc for full rationale: `docs/superpowers/specs/2026-04-28-feat-0002-pairing-design.md`.
