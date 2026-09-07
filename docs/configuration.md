# Configuration

Run commands from the repository root. The launcher reads environment variables and
discovers the current Tailscale DNS name and owner with `tailscale status --json`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CMUX_REMOTE_PORT` | `49163` | Loopback HTTP port,1024–65535. |
| `CMUX_REMOTE_HTTPS_PORT` | `8443` | Port used in the printed Tailscale HTTPS URL. |
| `CMUX_BIN_PATH` | `/Applications/cmux.app/Contents/Resources/bin/cmux` | Native cmux executable. |
| `TAILSCALE_BIN_PATH` | `tailscale` | Tailscale executable name or path. |
| `CMUX_REMOTE_STATE_DIR` | `$HOME/Library/Application Support/cmux-remote/input-state` | Private durable input-recovery markers. |

The legacy `PORT` variable is accepted only when `CMUX_REMOTE_PORT` is absent.
Ports must be integers. Recovery storage must be an absolute, user-owned directory
with private permissions. Startup creates it when missing.

For example, to use another loopback port:

```sh
CMUX_REMOTE_PORT=49164 bun run start
tailscale serve --bg --https=8443 http://127.0.0.1:49164
```

Changing the printed HTTPS port does not configure Tailscale Serve automatically.
Run the corresponding Serve command yourself.

If the GUI Tailscale installation has no shell command on PATH:

```sh
TAILSCALE_BIN_PATH=/Applications/Tailscale.app/Contents/MacOS/tailscale bun run doctor
```

The remote host and allowed identity are deliberately discovered from Tailscale.
There is no arbitrary remote-origin or alternate-proxy setting. User-owned devices
with a Tailscale `.ts.net` DNS name are supported; tagged nodes are not owners.

## Native authentication

By default, start the bridge inside a cmux terminal. For launchd or another external
process, first configure password-mode access in cmux's Automation settings using
its own credential storage. Run doctor from the intended execution environment.

The bridge does not set `CMUX_SOCKET_MODE` or change cmux permissions. Standard
native cmux options such as `CMUX_SOCKET_PATH` and its credential sources remain
owned by cmux.

## Build output

`CMUX_REMOTE_BUILD_DIR` changes the client build destination for release validation
or staging. Normal runtime serves `client/dist`; `bun run dev` rejects a different
build destination so it cannot silently serve stale assets.
Use a dedicated empty directory for staging. Do not point it at unrelated files.
