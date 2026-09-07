export interface AccessConfig {
  localOrigin: string;
  remoteOrigin: string;
  allowedLogin: string;
}
// Bind only to loopback: Tailscale Serve strips spoofed identity headers.
export function authorizeRequest(req: Request, config: AccessConfig): boolean {
  const url = new URL(req.url);
  let expectedOrigin: string;
  if (url.host === new URL(config.localOrigin).host) {
    // Serve preserves Host, so a remote peer can claim the localhost name.
    // Its forwarded markers must never enter the direct-local trust path.
    if (
      [
        "X-Forwarded-For",
        "X-Forwarded-Proto",
        "X-Forwarded-Host",
        "Forwarded",
        "Tailscale-User-Login",
        "Tailscale-Headers-Info",
        "Tailscale-Funnel-Request",
      ].some((key) => req.headers.has(key))
    )
      return false;
    expectedOrigin = config.localOrigin;
  } else if (
    url.host === new URL(config.remoteOrigin).host &&
    config.allowedLogin &&
    req.headers.get("Tailscale-User-Login") === config.allowedLogin
  )
    expectedOrigin = config.remoteOrigin;
  else return false;
  const origin = req.headers.get("Origin");
  if (url.pathname === "/ws") return origin === expectedOrigin;
  return origin === null || origin === expectedOrigin;
}
