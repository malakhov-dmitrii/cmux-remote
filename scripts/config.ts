import { access, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { AccessConfig } from "../server/src/access";
import { defaultStateDirectory } from "../server/src/input-state";
import { runProcess } from "../server/src/process";
import { isRecord } from "../shared/protocol";

export interface Config {
  port: number;
  httpsPort: number;
  cmuxBinary: string;
  tailscaleBinary: string;
  stateDirectory: string;
  assetsDirectory: string;
}
function port(value: string | undefined, fallback: number, name: string): number {
  if (value !== undefined && !/^\d+$/.test(value))
    throw new Error(`${name} must be a whole-number port.`);
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 1024 || result > 65535)
    throw new Error(`${name} must be between 1024 and 65535.`);
  return result;
}
function binary(value: string | undefined, fallback: string, name: string) {
  const result = value ?? fallback;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Executable paths must reject control characters before spawning.
  if (!result || /[\x00-\x1f\x7f]/.test(result))
    throw new Error(`${name} must name an executable.`);
  return result;
}
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const stateDirectory = defaultStateDirectory(env);
  if (!isAbsolute(stateDirectory))
    throw new Error("CMUX_REMOTE_STATE_DIR must be an absolute directory path.");
  return {
    port: port(env.CMUX_REMOTE_PORT ?? env.PORT, 49163, "CMUX_REMOTE_PORT"),
    httpsPort: port(env.CMUX_REMOTE_HTTPS_PORT, 8443, "CMUX_REMOTE_HTTPS_PORT"),
    cmuxBinary: binary(
      env.CMUX_BIN_PATH,
      "/Applications/cmux.app/Contents/Resources/bin/cmux",
      "CMUX_BIN_PATH",
    ),
    tailscaleBinary: binary(env.TAILSCALE_BIN_PATH, "tailscale", "TAILSCALE_BIN_PATH"),
    stateDirectory,
    assetsDirectory: resolve(import.meta.dir, "../client/dist"),
  };
}
export function parseTailscaleIdentity(
  value: unknown,
  config: Pick<Config, "port" | "httpsPort">,
): AccessConfig {
  if (
    !isRecord(value) ||
    value.BackendState !== "Running" ||
    !isRecord(value.Self) ||
    !isRecord(value.User) ||
    (typeof value.Self.UserID !== "string" && typeof value.Self.UserID !== "number")
  )
    throw new Error("Connect Tailscale on this Mac first.");
  const profile = value.User[String(value.Self.UserID)];
  if (
    !isRecord(profile) ||
    typeof profile.LoginName !== "string" ||
    !profile.LoginName ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: A trusted identity header cannot contain whitespace or control characters.
    /[\x00-\x20\x7f]/.test(profile.LoginName) ||
    typeof value.Self.DNSName !== "string"
  )
    throw new Error("Tailscale owner identity is unavailable. Use a user-owned device.");
  const dns = value.Self.DNSName.toLowerCase().replace(/\.$/, "");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+ts\.net$/.test(dns))
    throw new Error("A Tailscale .ts.net DNS name is required.");
  return {
    localOrigin: `http://127.0.0.1:${config.port}`,
    remoteOrigin: `https://${dns}:${config.httpsPort}`,
    allowedLogin: profile.LoginName,
  };
}
export async function discoverAccess(config: Config): Promise<AccessConfig> {
  const output = await runProcess(config.tailscaleBinary, ["status", "--json"]);
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("Tailscale returned invalid status JSON.");
  }
  return parseTailscaleIdentity(value, config);
}
export async function checkAssets(directory: string): Promise<void> {
  try {
    const html = await readFile(join(directory, "index.html"), "utf8");
    if (!/<script\b[^>]*\bsrc=["']\//i.test(html)) throw new Error("Missing client bundle.");
    for (const match of html.matchAll(/\b(?:src|href)=["'](\/[^"']+)["']/g)) {
      const path = match[1];
      if (!path || !/^\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes(".."))
        throw new Error("Invalid client asset path.");
      await access(join(directory, path.slice(1)));
    }
    await access(join(directory, "sw.js"));
    const manifest: unknown = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    if (!isRecord(manifest) || !Array.isArray(manifest.icons) || manifest.icons.length === 0)
      throw new Error("Missing icons.");
    for (const icon of manifest.icons) {
      if (!isRecord(icon) || typeof icon.src !== "string" || !/^\/[a-zA-Z0-9_.-]+$/.test(icon.src))
        throw new Error("Invalid icon path.");
      await access(join(directory, icon.src.slice(1)));
    }
  } catch {
    throw new Error("Built client assets are missing or incomplete. Run bun run build first.");
  }
}
