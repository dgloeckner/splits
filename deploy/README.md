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
     bash deploy/install.sh
```

`install.sh` installs the bundle it sits in as the release slot
`/opt/splits/releases/<ver>` and points `/opt/splits/current` at it (see
*Unattended updates* below). `VERSION` inside the tarball names the
release and the exact commit; `ARCH` names the board. From then on a
tagged install updates itself every night. Installing by hand again is
the same procedure with another tarball; `install.sh` is idempotent,
restarts the service and keeps the slot it replaced as
`/opt/splits/previous`. `nightly` is replaced on every push to `main`
and is meant for trying things out, not for keeping — a `nightly` slot
is hand-managed and never updated automatically.

An install from before the slot layout (a plain binary at
`/usr/local/bin/splits`, a real directory at `/var/www/splits`) is
migrated by the first run of the new `install.sh`; the env file, the
database and the Caddyfile are kept.

## Build + install from source

On a workstation with this repo checked out, `deploy/bundle.sh` produces
the same tarball CI publishes:

```bash
TARGET=arm bash deploy/bundle.sh   # → dist/splits-linux-armv7-<git describe>.tar.gz
```

Copy it to the Pi and follow the steps under *Install from a release*.
`install.sh` only installs a bundle: the old `BIN=` / `WEB_DIST=`
variables are gone. A bundle built from a working tree is named after
`git describe` (e.g. `v0.4.1-3-gabc1234`), which is not a release tag, so
that Pi is hand-managed until a tagged release is installed on it.

The installer is idempotent: re-running reinstalls the slot, updates the
Caddyfile and restarts the service. The env file
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

## Unattended updates

A Pi installed from a tagged release keeps itself current (ADR-0023,
FEAT-0016). Every night at 04:30 (plus up to an hour of jitter, an hour
after the 03:30 backup) `splits-update.timer` runs
`/opt/splits/current/deploy/splits-update.sh`, which installs the
repository's **latest non-pre-release GitHub Release** when it is newer
than what is installed — and rolls back by itself if the new version
does not come up. Publishing a Release is the act that moves every Pi;
`-rc` tags and `nightly` are never installed automatically.

### Layout

```
/opt/splits/
  releases/v0.4.0/          one extracted bundle: bin/ web/dist/ deploy/ VERSION ARCH
  releases/v0.4.1/
  current  -> releases/v0.4.1     what runs (the only record of what is installed)
  previous -> releases/v0.4.0     the rollback target
  blocked                         tags that failed here, one per line
  update-state.json               the last run's verdict (shown on Profil)
/usr/local/bin/splits -> /opt/splits/current/bin/splits
/var/www/splits       -> /opt/splits/current/web/dist
/var/lib/splits/update-backup/    pre-update DB copies, newest 3 kept
```

A slot not named after a release tag (`dev`, `nightly`, a `git describe`
string) is a **hand-managed install**: the updater refuses it with exit
2 and changes nothing. Install a tagged release with `install.sh` to
hand the Pi to the updater.

### What a run does

1. Refuses — and exits 0, "no update tonight" — when updates are off,
   GitHub is unreachable, the latest tag is not a plain `vX.Y.Z`, it is
   the installed one, it is *older* (never downgrades), it is in
   `blocked`, somebody is rowing (`/api/health` reports
   `session_open: true`), or the service is running but not answering.
2. Downloads `splits-linux-<arch>-<tag>.tar.gz` and `SHA256SUMS`,
   verifies the checksum, unpacks into `releases/.incoming-<tag>` and only
   then renames it to `releases/<tag>`.
3. Stops `splits`, copies the database to `update-backup/`, points
   `previous` at the old slot and swaps `current` with one rename, starts
   `splits`.
4. Waits up to `SPLITS_UPDATE_HEALTH_TIMEOUT` seconds for `/api/health`
   to report **the new tag**. Success prunes old slots; failure rolls
   back (below).

The updater does not touch systemd units, the env file or the
Caddyfile. A release that changes one of them says so in its notes; apply
it by running that release's `install.sh`.

### Commands

| Task | Command |
|---|---|
| What is installed, previous, blocked, last result | `sudo /opt/splits/current/deploy/splits-update.sh --status` |
| What tonight's run would do (changes nothing) | `sudo /opt/splits/current/deploy/splits-update.sh --check` |
| Update now instead of tonight | `sudo systemctl start splits-update.service` |
| Read the story of the last runs | `journalctl -u splits-update` |
| Forget a failed tag so it may be retried | `sudo /opt/splits/current/deploy/splits-update.sh --clear-block` |
| Next scheduled run | `systemctl list-timers splits-update.timer` |

### Configuration (`/etc/splits/splits.env`)

| Key | Default | Meaning |
|---|---|---|
| `SPLITS_UPDATE_ENABLED` | `1` | `0` opts this Pi out; the timer still runs and records "off" |
| `SPLITS_UPDATE_PIN` | (empty) | hold at exactly this tag (e.g. `v0.4.1`); never moves past it |
| `SPLITS_UPDATE_REPO` | `dgloeckner/splits` | where Releases come from (a fork) |
| `SPLITS_UPDATE_HEALTH_TIMEOUT` | `120` | seconds the new version has to report healthy |

**Opting out entirely:** set `SPLITS_UPDATE_ENABLED=0`, or
`sudo systemctl disable --now splits-update.timer`. The cadence is not a
config key: anything other than nightly is a systemd drop-in for the
timer (`systemctl edit splits-update.timer`), and keep in mind that the
rollback restores the pre-update database — the night-time window is what
makes that safe.

### What a rollback looks like

```
$ journalctl -u splits-update -n 20
splits-update: installed v0.4.1, latest release v0.4.2
splits-update: downloading splits-linux-armv7-v0.4.2.tar.gz
splits-update: checksum verified
splits-update: stopping splits.service
splits-update: database backed up to /var/lib/splits/update-backup/splits-v0.4.1-20261019T044107Z.db
splits-update: current -> v0.4.2
splits-update: waiting up to 120s for /api/health to report v0.4.2
splits-update: WARNING: v0.4.2 did not report healthy within 120s; rolling back to v0.4.1
splits-update: database restored from /var/lib/splits/update-backup/splits-v0.4.1-20261019T044107Z.db
splits-update: current -> v0.4.1
splits-update: v0.4.1 is serving again
splits-update: WARNING: rolled back to v0.4.1 and blocked v0.4.2; nothing is installed until a newer release exists or --clear-block is run
systemd[1]: splits-update.service: Main process exited, code=exited, status=1/FAILURE
```

Profil then shows „Update auf v0.4.2 fehlgeschlagen — läuft weiter auf
v0.4.1". The Pi keeps running v0.4.1 and ignores v0.4.2 for good; the
next newer Release is installed normally. If the old version does not
come back either, the journal says `CRITICAL` — that Pi needs a person.

### Going back by hand

The updater never downgrades (database migrations are forward-only). To
return to an older release: stop `splits`, restore the matching DB copy
from `update-backup/` (or a daily backup, see *Restoring from backup*),
then run the older release's `install.sh`. Set `SPLITS_UPDATE_PIN` to
that tag first, or the next night's run installs the latest Release
again.

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
`splits ls-*`, `splits --version`) live in the binary at
`/usr/local/bin/splits` (a link into `/opt/splits/current`).
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
sudo systemctl disable --now splits.service splits-backup.timer splits-update.timer
sudo rm -f /etc/systemd/system/splits.service \
           /etc/systemd/system/splits-backup.{service,timer} \
           /etc/systemd/system/splits-update.{service,timer} \
           /usr/local/bin/splits /usr/local/bin/splits-backup.sh /var/www/splits
sudo rm -rf /opt/splits
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
The same `VERSION` is stamped into the binary (`splits --version`,
`GET /api/health`) and the PWA (Profil footer), and the bundle carries an
`ARCH` file (`linux-armv7`, …) that the updater uses to pick its asset.

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
├── splits-update.service     nightly updater (oneshot, root)
├── splits-update.timer       04:30 daily timer, ±1 h jitter
├── install.sh                idempotent installer of the bundle it sits in
└── test/                     installer + updater suites (CI; not shipped)
```
