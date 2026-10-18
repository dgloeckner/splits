# FEAT-0016: Unattended Updates

- **Status**: Draft
- **Owner**: @dgloeckner
- **Depends on**: [ADR-0023](../adr/0023-unattended-ota-updates.md) (Unattended OTA updates), [ADR-0022](../adr/0022-ci-and-release-packaging.md) (CI and release packaging), [FEAT-0006](0006-pwa-installability.md) (PWA installability)
- **Issue**: [#22](https://github.com/dgloeckner/splits/issues/22)

## Summary

The Pi behind the Ergo keeps itself up to date. Every night it checks
whether a newer splits Release exists, installs it while nobody is
rowing, and goes back to the previous version on its own if the new one
does not come up. The household sees which version is running — and
whether an update is pending or failed — on the Profil page, and an open
app is never reloaded under somebody's hands mid-session.

## User stories

- As the household's admin, I want a published Release to reach the Pi
  without me logging in to it, so that fixes arrive while I am not
  thinking about the Pi.
- As the household's admin, I want a broken release to roll itself back,
  so that the Ergo still works the next morning.
- As a rower, I want to see on Profil which version runs and whether it
  is current, pending, or stuck, so that I can tell the admin when
  something is wrong.
- As a rower mid-session, I never want the app to reload by itself, so
  that a deploy cannot cost me the Live view.

## Acceptance criteria

### Version stamping (stage 1)

- [ ] `splits --version` prints the release tag and the commit; an
      unstamped build reports `dev`.
- [ ] `GET /api/health` returns `version`, `commit` and `session_open`
      alongside `status`.
- [ ] The Profil footer shows the release tag of the bundle the PWA came
      from (`splits v0.4.1 · Build abc1234`).
- [ ] `release.yml` fails on a tag without the `v` prefix; the PWA inside
      a tagged bundle is stamped with that tag.

### Slot layout (stage 2)

- [ ] After `install.sh` from a tagged bundle `readlink /opt/splits/current`
      names the tag, `/usr/local/bin/splits` and `/var/www/splits` are
      symlinks into it, and `splits-update.timer` is enabled.
- [ ] Re-running `install.sh` is idempotent.
- [ ] An existing flat install is migrated; the database, `splits.env`
      and the Caddyfile survive.

### Updater (stage 3)

- [ ] `splits-update.sh --check` on an up-to-date host exits 0 and names
      the installed version and the latest Release.
- [ ] Every refusal in ADR-0023 §3 exits 0, logs its reason and writes
      `update-state.json`; a hand-managed slot exits 2.
- [ ] A successful update moves `current`, sets `previous`, backs up the
      DB with the service stopped, prunes old slots and keeps three
      backups.
- [ ] A failed update exits 1, restores `current` and the DB
      byte-for-byte, blocks the tag and names it in `update-state.json`;
      the next run refuses it, `--clear-block` lets it retry.
- [ ] `deploy/test/updater-flow.sh` and `deploy/test/updater-version.sh`
      run in CI.
- [ ] Real hardware (Pi Zero, `PROFILE=pi-zero`): `vA` → `vB` serves
      `vB`; a deliberately broken `vC` is rolled back to `vB` and blocked;
      `journalctl -u splits-update` tells the story.

### Reporting (stage 4)

- [ ] `GET /api/v1/update-status` returns `current`, `behind`, `stuck`,
      `unknown` or `off`.
- [ ] Profil shows an "Updates" block (`data-testid="update-status"`)
      for each state; *behind* is not styled as an error and differs
      visibly from *stuck*.

### Reload policy (stage 5)

- [ ] A newly installed service worker never reloads the page by itself.
- [ ] While a session is open or the Live view is mounted, the update
      offer is deferred; on the next navigation to Home or Verlauf the
      toast „Neue Version verfügbar — Neu laden" appears and applies the
      new version.

## UX notes

Profil, section „Updates", one card:

| State   | Line 1                                   | Line 2                                       | Tone   |
|---------|------------------------------------------|----------------------------------------------|--------|
| current | Installiert v0.4.1 · aktuell             | Zuletzt geprüft 19.10., 04:41                | normal |
| behind  | Installiert v0.4.1                       | Neu: v0.4.2 — wird heute Nacht installiert   | info   |
| stuck   | Update auf v0.4.2 fehlgeschlagen         | läuft weiter auf v0.4.1                      | warn   |
| off     | Automatische Updates aus                 | Installiert v0.4.1                           | muted  |
| unknown | Update-Status unbekannt                  | (version from `/api/health` when known)      | muted  |

Footer: `splits v0.4.1 · Build abc1234`.

Toast: „Neue Version verfügbar" with the action „Neu laden" (the existing
toast-with-action).

## Non-goals

- Installing `nightly` or `-rc` releases automatically.
- An „Jetzt aktualisieren" button in the PWA — the updater is a root
  timer and the PWA is a paired household client, not an admin panel.
- Updating Caddy, the OS or systemd units.
- Signatures beyond TLS + SHA-256.

## Open questions

- Should a stuck Pi also surface on Home, not only on Profil? Deferred
  until a real rollback has been seen in a household.
