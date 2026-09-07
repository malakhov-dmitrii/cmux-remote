# Migrating from the local trial

The trial launcher is retained as a compatibility entry:

```sh
bun scripts/start-trial.ts
```

It now uses the same validated configuration and startup as `bun run start`.
The default loopback and HTTPS ports remain 49163 and 8443.

Install from the repository root with the root Bun lockfile, then rebuild:

```sh
bun install --frozen-lockfile
bun run build
bun run doctor
bun run start
```

Reload existing browser tabs after replacing the bridge. The versioned protocol
rejects legacy requests so cached clients cannot keep using the old multi-request
submission path.

The release tree contains no private trial hostname, pairing URL, operator paths,
or private test screenshots. Local operator notes should stay outside the checkout.

See [configuration](docs/configuration.md), [background operation](docs/operations.md),
and [troubleshooting](docs/troubleshooting.md).
