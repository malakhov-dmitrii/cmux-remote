# Contributing

Start with a focused issue for protocol, authentication, or storage changes. Include
the user-visible problem and the smallest proposed change. Small bug fixes can go
directly to a pull request.

## Setup

Install the Bun version in `.bun-version`, then run from the repository root:

```sh
bun install --frozen-lockfile
bun run check
```

Tests use temporary files, loopback listeners, and fake cmux executables. They do not
need a running cmux app or Tailscale account. Live use requires a Mac with both apps.

For development inside a cmux terminal:

```sh
bun run dev
```

The server and client use one origin. Client source is rebuilt on change; reload
the browser to load the new bundle. Do not add a proxy that rewrites arbitrary
browser origins into trusted ones.

## Change boundaries

- Keep user-interface and system-owned prose in English. Terminal output and
  workspace names are user data; preserve them exactly.
- Preserve the small mobile interface and test narrow screens and visual-viewport
  changes when editing layout.
- Keep wire validation in `shared/protocol.ts`, native process integration on the
  server, and presentation in the client.
- Preserve explicit UUID targeting and uncertain-input recovery. Never retry input
  automatically or clear a recovery marker without a confirmed operator action.
- Add tests at the affected boundary. A regression should fail on the old behavior.
- Remove unused code when replacing a path. Avoid parallel implementations.
- Use `bun run format`, then `bun run check`. Keep changes related to the issue.

## Visual assets

The app icon uses Tabler's Terminal2 icon. To regenerate the committed assets, install
ImageMagick 7 and run `bun run icons`. Normal installation and CI do not need ImageMagick.
Retain the Tabler notice in `LICENSES/Tabler.txt` when distributing generated icons.

## Review evidence

State which checks ran and which did not. A passing mock test does not prove native
cmux behavior; a successful local request does not prove a phone can reach the Mac.
Use disposable terminals for live input checks. Never attach unredacted transcripts.

See [SECURITY.md](SECURITY.md) for the trust model and [docs/releasing.md](docs/releasing.md)
for the release checklist.
