# backend — Home Ergo backend

Go service that reads the FDF IPM serial console, derives per-stroke metrics, broadcasts a Server-Sent-Events stream, and persists sessions to SQLite.

## Run against a fixture (no hardware needed)

```bash
cd backend
SPLITS_FIXTURE=../specs/int/fixtures/ipm/session-short.csv \
SPLITS_FIXTURE_RATE=realtime \
SPLITS_DB_PATH=./dev.db \
go run ./cmd/homeergo
```

- `realtime` pacing honours the original inter-stroke timing (~0.5 Hz).
- Use `fast` pacing for tight dev loops.

The PWA at `http://localhost:5173/` proxies `/api/*` to `http://localhost:8080/`, so start the fixture first and then `npm run dev` in `../web/`.

## Run against the real IPM console

```bash
cd backend
SPLITS_SERIAL_PORT=/dev/cu.usbserial-AB0JKG07 go run ./cmd/homeergo
```

If the port is left unset the backend auto-detects the FTDI `0403:6001` (see INT-0001).

## Tests

```bash
go test ./...
```

The e2e smoke in `cmd/homeergo/main_sse_test.go` boots a real server against a fixture and asserts the SSE stream shape.

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
