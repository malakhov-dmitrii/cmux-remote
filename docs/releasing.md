# Releasing

Use this checklist to validate a version and publish its source archive.

## Before a release

1. Set the release version in root and workspace package metadata and update the
   changelog. Keep `.bun-version` and `packageManager` aligned.
2. Run `bun install --frozen-lockfile` and `bun run check`.
3. Exercise the live browser flow against a disposable cmux terminal: read output,
   insert-only, submit, Enter, Ctrl+C and reconnect. Validate mobile keyboard layout.
4. Check the private Tailscale route from a second device. Record which native and
   phone checks were performed; do not substitute mock tests for those results.
5. Review SECURITY.md and enable private vulnerability reporting on the destination
   repository. Keep the original license and third-party notices.
6. Confirm no credentials, private hostnames, transcripts or operator receipts are
   included. `check:release` performs source/privacy/link/asset checks, but maintainers
   must still review the diff and archive.

## Build a source archive

```sh
bun run release:archive
```

The command writes a source tarball and SHA-256 checksum under `.release/`. It uses
an explicit public-file inventory, excludes Git state, dependencies, build output,
local environment files and runtime storage, and adds per-file hashes in
`SOURCE-MANIFEST.json`.
The packer suppresses macOS metadata and verifies the finished archive contains
exactly the expected files before writing its checksum.

Extract the archive into an empty directory and repeat:

```sh
bun install --frozen-lockfile
bun run check
```

The clean extraction is the contributor setup test. The dependency versions are
locked; archive timestamps are not a claim of bit-for-bit reproducible packaging.

## CI and publication

CI is configured for Ubuntu and macOS with pinned official actions and a pinned Bun
version. It runs the same check command and uploads source archives. A workflow file
in a local checkout does not prove that remote CI has run.

After review and successful checks on the destination repository, create the desired
tag/release and attach the verified archive and checksum. Do not point users to an
upstream repository that lacks this release's changes.

## Updating an existing host

Retain the previous source, client build and configuration for rollback. Install and
build the replacement in a separate location, verify it, then replace the bridge and
client together. Protocol-version changes require existing browser tabs to reload.

The compatibility trial entry calls the canonical launcher, but does not add an
autostart service or alter the host's sleep/authentication settings.
