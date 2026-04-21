# backend — Home Ergo backend

Go service that reads the FDF IPM serial console, derives per-stroke metrics, broadcasts a Server-Sent-Events stream, and persists sessions to SQLite.

## Run against a fixture (no hardware needed)

```bash
cd backend
HOMEERGO_FIXTURE=specs/int/fixtures/ipm/session-short.csv \
HOMEERGO_FIXTURE_RATE=realtime \
HOMEERGO_DB_PATH=./dev.db \
go run ./cmd/homeergo
```

- `realtime` pacing honours the original inter-stroke timing (~0.5 Hz).
- Use `fast` pacing for tight dev loops.

The PWA at `http://localhost:5173/` proxies `/api/*` to `http://localhost:8080/`, so start the fixture first and then `npm run dev` in `../web/`.

## Run against the real IPM console

```bash
cd backend
HOMEERGO_SERIAL_PORT=/dev/cu.usbserial-AB0JKG07 go run ./cmd/homeergo
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
| `HOMEERGO_ADDR`             | `:8080`                   | HTTP listen address                             |
| `HOMEERGO_SERIAL_PORT`      | auto-detect FTDI          | Override for non-FTDI / multi-device            |
| `HOMEERGO_SERIAL_BAUD`      | `9600`                    | Per INT-0001                                    |
| `HOMEERGO_DB_PATH`          | `./homeergo.db`           | SQLite file                                     |
| `HOMEERGO_FIXTURE`          | unset                     | CSV / bin fixture in place of serial            |
| `HOMEERGO_FIXTURE_RATE`     | `realtime`                | `realtime` or `fast` pacing                     |
| `HOMEERGO_LOG_LEVEL`        | `info`                    | `debug` / `info` / `warn` / `error`             |
| `HOMEERGO_IDLE_TIMEOUT`     | `60s`                     | Stroke gap that closes a session                |

## Debugging

`GET /debug/ingest` returns pipeline health JSON (LAN-only; no auth in v1).
