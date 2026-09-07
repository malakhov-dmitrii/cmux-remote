# Security

cmux Remote can type into terminals with the permissions of the Mac user running it.
Treat access to it as access to those terminals.

## Supported trust boundary

The HTTP listener binds only to loopback. Remote access is supported through Tailscale
Serve, which supplies the authenticated Tailscale account identity and strips incoming
identity headers. The bridge checks that identity against the Mac's Tailscale owner,
checks the configured host, and requires an exact browser Origin for WebSocket upgrades.

Direct loopback access is available to local processes. Local applications and users
who can call the loopback service are inside the trust boundary. The identity headers
are not cryptographic credentials on their own. This design is unsuitable for an
untrusted shared host.

Tailscale Serve is the only supported remote proxy. A different proxy that forwards
attacker-supplied identity headers breaks the trust model. Public internet exposure,
Tailscale Funnel, generic Cloudflare tunnels, and multi-user administration are outside
the supported deployment.

## Native cmux access

The bridge uses cmux's existing socket authentication. Running from a cmux terminal
works with the default process-ancestry mode. A background process requires native
password-mode access configured by the operator. The launcher does not switch cmux
to open access or invent a process-ancestry environment.

Use cmux's own credential configuration. Never put a password in a public issue,
release archive, example file, or command argument. The generated launchd template
does not contain a password.

## Input safety

The bridge validates versioned requests and a small method allowlist. Every terminal
request names both workspace and surface UUIDs. Input never passes through a shell
on the bridge; JSON is one argument to the native cmux CLI.

A submit operation holds a per-terminal lock through text and Enter. Competing remote
writes fail busy instead of waiting in a replay queue. Before a native write, the
bridge creates a private pending marker. It clears that marker after native cmux
acknowledges every stage of the operation. Incomplete or uncertain native writes
leave further writes blocked, including after a bridge restart.

A browser can lose the reply after native completion. In that case the marker may
already be cleared; the originating browser keeps its own unknown-result guard and
does not retry. Native acknowledgement does not guarantee browser receipt.

Recovery requires an explicit confirmed Ctrl+C action. It can stop the running program
and discard pending input. It is never automatic. The marker stores no command or
terminal output. The state directory requires mode 0700 and marker files use mode 0600.

These protections do not lock the physical Mac keyboard or unrelated cmux clients.
Insert-only input intentionally edits a shared terminal buffer. Avoid simultaneous
manual editing from multiple places.

## Data handling

The bridge keeps no transcript database and does not send terminal content to an
application analytics service. Terminal snapshots and drafts exist in browser memory.
The browser stores display preferences and selected workspace/surface IDs locally.
Recovery markers are the only durable bridge input state.

Host tools, shell history, browser behavior, and Tailscale have their own data handling.
Native CLI arguments can be visible to local processes; this project assumes a trusted
local host.

## Reporting a vulnerability

Use this repository's private vulnerability reporting when it is enabled. Do not post
exploit details, credentials, private hostnames, or transcripts in public issues.
If no private channel is available, open a public issue requesting a private contact
without including the vulnerability details.

Before publishing a fork, maintainers should enable GitHub private vulnerability
reporting and document any additional private contact channel. No external audit or
security certification is claimed.
