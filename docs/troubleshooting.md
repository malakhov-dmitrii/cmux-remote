# Troubleshooting

Start with:

```sh
bun run doctor
```

Doctor reads configuration, native cmux access, Tailscale identity, built assets,
and recovery-directory metadata. It makes no settings changes and does not type
into terminals. Its Tailscale check does not verify Serve routing.

## The page does not open

Confirm the bridge process is running and the Mac is awake. Enable Tailscale on both
devices under the same account. Check `tailscale serve status` and compare its backend
port with `CMUX_REMOTE_PORT`. Use the HTTPS URL printed by the launcher.

A successful local health request does not establish that the phone has a network
path to the Mac.

## Native cmux access fails

Run the foreground bridge from a terminal inside cmux. For background operation,
configure cmux's password-mode access first. Do not work around this by opening
the native socket to every local process.

If an executable cannot be found, set `CMUX_BIN_PATH` or `TAILSCALE_BIN_PATH`.
See [configuration](configuration.md).

## Assets are missing

Run `bun install --frozen-lockfile`, then `bun run build` from the root. Startup
checks the built index, bundles, service worker and declared icons before listening.

## Input needs recovery

Inspect the current output. Use the explicit recovery control only when you intend
to send Ctrl+C to that terminal; it may interrupt a running program.

Do not delete pending markers to bypass the message. Do not resend a command whose
result is uncertain. Recovery is successful only after the bridge confirms Ctrl+C
and clears the marker.

If storage cannot be written, fix the owner/permissions of the configured recovery
directory. The bridge deliberately refuses input when it cannot retain uncertainty.

## A terminal cannot be read

A newly created terminal may need to be selected once on the Mac before cmux can
read its screen. Closed workspaces or surfaces require a new explicit selection.
A live connection alone does not mean the selected terminal is ready.

## The page looks stale after an update

Reload the page. Protocol-version failures require a reload, not another attempt
to send the same input. Drafts are retained while reconnecting within the page,
but are not stored as persistent transcripts.

## Mobile keyboard or layout problems

Report the browser/iOS version, orientation, whether the page is installed on the
Home Screen, and whether the keyboard is visible. Share a screenshot only after
removing private terminal content. Layout checks with an emulated viewport do not
replace validation on the affected phone.
