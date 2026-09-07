# Architecture and protocol

```mermaid
flowchart LR
  Phone[Browser on phone] -->|Private HTTPS and WebSocket| Serve[Tailscale Serve]
  Serve -->|Loopback plus owner identity| Bridge[Bun and Hono bridge]
  Bridge -->|Validated JSON arguments| CLI[cmux CLI]
  CLI -->|Native authenticated socket| Mac[cmux terminals]
```

The browser selects workspaces and surfaces locally. It does not focus the Mac's UI.
It requests a workspace list, the selected workspace's surface list, and a snapshot
of the selected terminal. Polling is serialized with a delay between cycles.

`shared/protocol.ts` owns request validation, response decoding, supported methods,
input limits and the view data types. The server owns native process execution,
authorization, input serialization and durable recovery state. The client owns
display, drafts, selection, freshness and user-driven recovery.

## WebSocket messages

Connect to `/ws` from the page's own origin. Every request requires protocol version 1:

```json
{
  "version": 1,
  "id": "request-1",
  "method": "workspace.list",
  "params": {}
}
```

A response is exactly a success envelope with `ok: true` and `result`, or a failure
envelope with `ok: false` and `error`. Missing or contradictory success fields
are rejected.

| Method | Parameters | Behavior |
| --- | --- | --- |
| `workspace.list` | none | List available workspaces. |
| `surface.list` | `workspace_ref` | List a workspace's surfaces. |
| `surface.read_text` | both target UUIDs | Read up to 200 lines. |
| `surface.send_text` | both target UUIDs, `text` | Insert one line without Enter. |
| `surface.send_key` | both target UUIDs, `key` | Send `enter` or `ctrl+c`. |
| `surface.submit` | both target UUIDs, `text` | Insert text and send Enter under one server lock. |

The target fields are named `workspace_ref` and `surface_ref`, but they accept stable
UUIDs only, not positional handles such as `surface:1`. This prevents a changed UI
position from redirecting input to another terminal.

Text is limited to 8,000 characters and cannot contain newlines or control bytes.
The server reconstructs allowed parameters; it is not a transparent cmux RPC proxy.

## Failures and recovery

Failures include `code`, English `message`, `delivery`, and optional diagnostic
`detail`. Delivery is one of:

- `not_sent`: the request was rejected before native input began.
- `unknown`: delivery could not be established.
- `text_inserted`: text was acknowledged but completion was not established.

An incomplete or uncertain native write leaves a private pending marker for the target. Further writes
return `recovery_required` until an explicit Ctrl+C request includes
`confirmRecovery: true` and succeeds. A client must not automatically retry input,
append Enter, or silently dismiss recovery requirements.

The server clears its marker after native cmux acknowledgement. If the browser loses
the reply after native completion, that browser retains an unknown-result guard even
though the server marker may be gone. Browser receipt is not guaranteed; the server
does not implement a separate browser-acknowledgement transaction.

The lock protects remote operations handled by this bridge. It does not coordinate
unrelated cmux clients or the physical keyboard.

## HTTP

`GET /health` returns 200 only when a native workspace-list response passes validation;
otherwise it returns 503. It is a readiness check for the local bridge-to-cmux path.
It does not prove phone reachability, a particular terminal's readiness, or write
availability when that terminal needs recovery.

All application assets and health responses are served without offline caching.
The service worker only retires previous application caches.
