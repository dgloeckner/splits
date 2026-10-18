# Deploying splits

Target hardware (per ADR-0001): a Raspberry Pi Zero 2 W or similar
always-on SBC, running Pi OS (32-bit ARMv7 default; 64-bit aarch64 also
fine). Caddy fronts the backend with HTTPS via DuckDNS DNS-01 (per
ADR-0006). Anything Caddy-supported should work; this guide assumes
Pi OS + Caddy + DuckDNS.

## What you get

- One systemd unit (`splits.service`) running the Go backend.
- Caddy reverse-proxying `/api/*` to the backend and serving the PWA
  shell from `/var/www/splits/`.
- Daily SQLite backup at 03:30 via systemd timer; 14 dailies retained,
  first-of-month copies hardlinked into `archive/` indefinitely.
- Production-safe env: backend bound to 127.0.0.1:8080, T10 TLS gate
  satisfied via `SPLITS_TLS_TERMINATED_BY=proxy`, cookie `Secure` flag
  on (DevMode off).

## One-time host prep

On the Pi:

```bash
sudo apt-get update
sudo apt-get install -y rsync sqlite3
```

Install Caddy with the DuckDNS plugin. Two options:

1. **Pre-built binary from xcaddy.** On the workstation:
   ```bash
   xcaddy build --with github.com/caddy-dns/duckdns
   scp caddy pi:/usr/local/bin/caddy
   ```

2. **System Caddy + module.** Install Caddy from the official APT repo,
   then drop a custom build that includes the DuckDNS module into
   `/usr/local/bin/caddy` (overrides the system binary). The systemd
   unit shipped by the APT package picks it up.

Either way, confirm:
```bash
caddy list-modules | grep duckdns
```

## Install from a release

CI builds one self-contained tarball per Linux target for every tagged
release (`v*`) and a rolling `nightly` pre-release from `main` (see
ADR-0022). Pick the file for your board:

| Asset                               | Hardware                                   |
|-------------------------------------|--------------------------------------------|
| `splits-linux-armv6-<ver>.tar.gz`   | Pi Zero / Zero W (original, ARMv6)         |
| `splits-linux-armv7-<ver>.tar.gz`   | Pi Zero 2 W, Pi 3 on 32-bit Pi OS          |
| `splits-linux-arm64-<ver>.tar.gz`   | Pi 3/4/5 on 64-bit Pi OS                   |
| `splits-linux-amd64-<ver>.tar.gz`   | x86-64 host (NAS, mini PC)                 |

On the Pi (after the one-time host prep above):

```bash
ver=v0.1.0   # or: nightly
arch=armv7
base=https://github.com/dgloeckner/splits/releases/download/$ver
curl -fLO "$base/splits-linux-$arch-$ver.tar.gz"
curl -fLO "$base/SHA256SUMS"
sha256sum -c --ignore-missing SHA256SUMS
tar xzf "splits-linux-$arch-$ver.tar.gz"
cd "splits-linux-$arch-$ver"
sudo HOSTNAME=homeergo.duckdns.org \
     DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
     BIN=./bin/splits \
     WEB_DIST=./web/dist \
     bash deploy/install.sh
```

`VERSION` inside the tarball names the release and the exact commit.
Upgrading is the same procedure with a newer tarball; `install.sh` is
idempotent (see below). `nightly` is replaced on every push to `main`
and is meant for trying things out, not for keeping.

## Build + install from source

On a workstation with this repo checked out, `deploy/bundle.sh` produces
the same tarball CI publishes:

```bash
TARGET=arm bash deploy/bundle.sh   # → dist/splits-linux-armv7-<git describe>.tar.gz
```

Copy it to the Pi and follow the steps under *Install from a release*.
Or build the pieces separately:

```bash
TARGET=arm deploy/build.sh        # → dist/splits-linux-armv7
cd web && npm ci && npm run build && cd ..
```

Copy the repo (or just the deploy/, dist/, web/dist/ subtrees) to the
Pi, then run as root on the Pi:

```bash
sudo HOSTNAME=homeergo.duckdns.org \
     DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
     BIN=./dist/splits-linux-armv7 \
     WEB_DIST=./web/dist \
     bash deploy/install.sh
```

The installer is idempotent: re-running upgrades the binary, refreshes
the PWA static files, and updates the Caddyfile. The env file
(`/etc/splits/splits.env`) and the database (`/var/lib/splits/splits.db`)
are preserved across upgrades.

## Verify

```bash
systemctl status splits.service
systemctl status splits-backup.timer
journalctl -u splits.service -n 50
curl -sI https://homeergo.duckdns.org/api/health
```

First load may take a minute or two while Caddy provisions the cert via
DuckDNS DNS-01.

## Operations

| Task | Command |
|---|---|
| Service status | `systemctl status splits` |
| Tail logs | `journalctl -u splits -f` |
| Restart | `systemctl restart splits` |
| List backups | `ls -lh /var/lib/splits/backups/` |
| Trigger backup now | `systemctl start splits-backup.service` |
| Edit env | `sudo $EDITOR /etc/splits/splits.env && sudo systemctl restart splits` |

CLI subcommands (`splits invite`, `splits revoke`, `splits delete-rower`,
`splits ls-*`) live alongside the binary at `/usr/local/bin/splits`.
Run them as root with the production env loaded:

```bash
sudo -u splits env $(cat /etc/splits/splits.env | xargs) splits ls-rowers
```

## Restoring from backup

```bash
sudo systemctl stop splits.service
sudo -u splits zcat /var/lib/splits/backups/splits-2026-05-01T03-30-00Z.db.gz \
  > /var/lib/splits/splits.db
sudo systemctl start splits.service
```

## Uninstall

```bash
sudo systemctl disable --now splits.service splits-backup.timer
sudo rm -f /etc/systemd/system/splits.service \
           /etc/systemd/system/splits-backup.{service,timer} \
           /usr/local/bin/splits /usr/local/bin/splits-backup.sh
# Data preserved unless you also remove these:
#   sudo rm -rf /var/lib/splits /etc/splits
sudo systemctl daemon-reload
```

## Build scripts

`deploy/build.sh` cross-compiles the backend. Targets:

- `TARGET=armv6` → `dist/splits-linux-armv6` for the original Pi Zero / Zero W.
- `TARGET=arm` (default) → `dist/splits-linux-armv7` for Pi Zero 2 W / Pi 3 (32-bit Pi OS).
- `TARGET=arm64` → `dist/splits-linux-arm64` for 64-bit Pi OS / RPi 3+ / 4 / 5.
- `TARGET=amd64` → `dist/splits-linux-amd64` for x86 hosts (NAS, Docker).

CGO is disabled and modernc-sqlite is pure-Go, so the binary is fully
static — no glibc-version surprises.

`deploy/bundle.sh` wraps `build.sh` + the web build and tars binary,
`web/dist/` and this directory into one installable archive (the same
thing `.github/workflows/release.yml` publishes). `WEB_SKIP=1` reuses an
existing `web/dist`; `VERSION=` overrides the `git describe` default.

## Files at a glance

```
deploy/
├── README.md                 (this file)
├── build.sh                  cross-compile the backend
├── bundle.sh                 build.sh + web build → one tarball (what CI publishes)
├── Caddyfile.template        production Caddy config
├── splits.service            systemd unit
├── splits.env.template       env file (rendered into /etc/splits/)
├── splits-backup.sh          daily SQLite backup script
├── splits-backup.service     oneshot systemd unit
├── splits-backup.timer       03:30 daily timer
└── install.sh                idempotent installer
```
