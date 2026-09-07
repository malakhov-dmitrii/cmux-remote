# Background operation

Foreground use is the default. Closing the bridge process stops the companion.
The Mac must remain awake, connected, and logged into the relevant user session.

## Optional launchd template

Before running outside a cmux terminal, configure native password-mode access in
cmux and verify access from the intended environment. The template contains no
credential and never weakens cmux settings.

Keep the checkout at a stable location. Install dependencies and build the client,
then generate a template:

```sh
bun install --frozen-lockfile
bun run build
bun run service:template > cmux-remote.plist
plutil -lint cmux-remote.plist
```

Inspect the generated absolute executable paths and state directory. The template
uses RunAtLoad, KeepAlive and a 30-second restart throttle. Generation writes only
to stdout; it does not install or start a service.

To install the reviewed template for your user account:

```sh
mkdir -p "$HOME/Library/LaunchAgents"
cp cmux-remote.plist "$HOME/Library/LaunchAgents/local.cmux-remote.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.cmux-remote.plist"
```

Do not overwrite an existing service configuration without reviewing and backing it
up first. Moving the checkout or Bun installation requires generating a new template.
The service still depends on cmux and Tailscale being available after login.

To stop and uninstall this user service:

```sh
launchctl bootout "gui/$(id -u)/local.cmux-remote"
rm "$HOME/Library/LaunchAgents/local.cmux-remote.plist"
```

To remove only the default private Serve route:

```sh
tailscale serve --https=8443 off
```

## Sleep and recovery

macOS can prevent automatic sleep while connected to power. Configure this explicitly
in system settings if unattended access is needed. A launch agent does not prevent
sleep, bypass login requirements, or recover an offline Mac.

Do not infer successful recovery from a configured plist. Validate startup after
login, restart after an intentional bridge-process failure, reconnection after
network recovery, and access from the actual phone using disposable terminals.

An external check from another Tailscale device is needed to detect an offline Mac.
No monitoring account or notification destination is configured by this repository.
