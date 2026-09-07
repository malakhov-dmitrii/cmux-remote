import { isAbsolute, resolve } from "node:path";
import { type Config, readConfig } from "./config";

const xml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
export function serviceTemplate(
  config: Config,
  bun = process.execPath,
  root = resolve(import.meta.dir, ".."),
): string {
  const cmux = Bun.which(config.cmuxBinary);
  const tailscale = Bun.which(config.tailscaleBinary);
  if (!isAbsolute(bun) || !isAbsolute(root) || !cmux || !tailscale)
    throw new Error(
      "Resolve existing Bun, cmux, and Tailscale executable paths before generating a service template.",
    );
  const env = {
    CMUX_REMOTE_PORT: String(config.port),
    CMUX_REMOTE_HTTPS_PORT: String(config.httpsPort),
    CMUX_BIN_PATH: cmux,
    TAILSCALE_BIN_PATH: tailscale,
    CMUX_REMOTE_STATE_DIR: config.stateDirectory,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.cmux-remote</string>
  <key>ProgramArguments</key><array><string>${xml(bun)}</string><string>${xml(resolve(root, "scripts/serve.ts"))}</string></array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict>${Object.entries(env)
    .map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`)
    .join("")}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
`;
}
if (import.meta.main) {
  try {
    process.stdout.write(serviceTemplate(readConfig()));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Could not generate the launchd template.",
    );
    process.exitCode = 1;
  }
}
