# Pi Zero / Zero W profile

Optional override for the original Raspberry Pi Zero (BCM2835, ARM11
single-core 1 GHz, 512 MB RAM). Activate with `PROFILE=pi-zero` when
running `deploy/install.sh`:

```bash
sudo PROFILE=pi-zero \
     HOSTNAME=splits.duckdns.org \
     DUCKDNS_TOKEN=xxx \
     BIN=./dist/splits-linux-armv6 \
     WEB_DIST=./web/dist \
     bash deploy/install.sh
```

## What it changes

`override.conf` is dropped in at
`/etc/systemd/system/splits.service.d/pi-zero.conf`:

| Setting | Default | Pi Zero |
|---|---|---|
| `MemoryHigh` | 256M | 192M |
| `MemoryMax` | 384M | 256M |
| `GOGC` | (100) | 20 |
| `GOMAXPROCS` | (auto) | 1 |

Rationale:

- **Memory caps** — 512 MB shared with kernel, Caddy, and any desktop.
  Hard ceiling at 256 M leaves headroom for the SSE ring + SQLite WAL.
- **`GOGC=20`** — runs Go GC ~5× more often. Trades CPU for ~30%
  smaller heap. ARM11 is I/O-bound on this workload (single-rower
  household, ≈1 frame/second from IPM), so the CPU cost is a
  rounding error and the heap savings matter.
- **`GOMAXPROCS=1`** — single physical core. Forcing the Go runtime
  to one OS thread avoids GC + handler context-switching against
  itself.

## Caveats

- **TLS termination is expensive on ARM11** (no AES hardware). If
  Caddy is the bottleneck, terminate TLS at your router or run plain
  HTTP on LAN with `SPLITS_TLS_TERMINATED_BY=proxy`.
- **Plain Pi Zero (no W)** has no Wi-Fi — needs USB-OTG ethernet or a
  Zero W. Confirm before installing.
- **First boot is slow** — Caddy provisions the cert on first start;
  expect ~30 s of CPU before the service responds.
