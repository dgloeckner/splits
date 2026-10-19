# dev/ — developer-machine Caddy

A local HTTPS front for running splits on a developer Mac, the same way the
Pi runs it: Caddy terminates TLS for the DuckDNS hostname via DNS-01
(ADR-0006), proxies `/api/*` to the Go backend on `localhost:8080`, and serves
the built PWA from `web/dist`.

The config is a template. The rendered `dev/Caddyfile` carries the DuckDNS
token and is git-ignored — **never commit it** (issue #23).

## Render

```bash
HOSTNAME=homeergo.duckdns.org \
DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
bash dev/render-caddyfile.sh
```

| Variable        | Required | Default                                   |
|-----------------|----------|-------------------------------------------|
| `HOSTNAME`      | yes      | —                                         |
| `DUCKDNS_TOKEN` | yes      | —                                         |
| `WEB_ROOT`      | no       | `../web/dist`, resolved to an absolute path |

`WEB_ROOT` is resolved at render time because Caddy reads a relative `root`
against its working directory, not against the Caddyfile. Build the PWA first
(`npm run build` in `web/`), or the script stops and says so. The output is
written mode 0600.

## Run

```bash
dev/caddy_darwin_amd64_custom run --config dev/Caddyfile
```

`caddy_darwin_amd64_custom` is a local Caddy build with the DuckDNS DNS
module (git-ignored); see `deploy/README.md` for the `xcaddy` command.
