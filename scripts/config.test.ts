import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Config,
  checkAssets,
  discoverAccess,
  parseTailscaleIdentity,
  readConfig,
} from "./config";
import { diagnose } from "./doctor";
import { serviceTemplate } from "./service";

const status = {
  BackendState: "Running",
  Self: { UserID: 7, DNSName: "test-machine.tailnet.ts.net." },
  User: { "7": { LoginName: "owner@example.test" } },
};
describe("portable configuration", () => {
  it("uses safe defaults and validates overrides", () => {
    expect(readConfig({})).toMatchObject({
      port: 49163,
      httpsPort: 8443,
      tailscaleBinary: "tailscale",
    });
    expect(
      readConfig({
        CMUX_REMOTE_PORT: "12345",
        CMUX_REMOTE_HTTPS_PORT: "9443",
        CMUX_BIN_PATH: "/custom/cmux",
        TAILSCALE_BIN_PATH: "/custom/tailscale",
        CMUX_REMOTE_STATE_DIR: "/tmp/private-input",
      }),
    ).toMatchObject({
      port: 12345,
      httpsPort: 9443,
      cmuxBinary: "/custom/cmux",
      tailscaleBinary: "/custom/tailscale",
      stateDirectory: "/tmp/private-input",
    });
    for (const value of ["", "0", "1023", "65536", "1.5", "1e4", "hello"])
      expect(() => readConfig({ CMUX_REMOTE_PORT: value })).toThrow();
    expect(() => readConfig({ CMUX_REMOTE_STATE_DIR: "relative" })).toThrow();
    expect(() => readConfig({ CMUX_BIN_PATH: "" })).toThrow();
  });
  it("accepts only running user-owned Tailscale identities with valid DNS", () => {
    const config = readConfig({});
    expect(parseTailscaleIdentity(status, config)).toEqual({
      localOrigin: "http://127.0.0.1:49163",
      remoteOrigin: "https://test-machine.tailnet.ts.net:8443",
      allowedLogin: "owner@example.test",
    });
    for (const value of [
      null,
      {},
      { ...status, BackendState: "Stopped" },
      { ...status, User: {} },
      { ...status, Self: { ...status.Self, DNSName: "attacker.example" } },
      { ...status, Self: { ...status.Self, DNSName: "bad..ts.net" } },
      { ...status, Self: { ...status.Self, DNSName: "evil.ts.net/path" } },
      { ...status, User: { "7": { LoginName: "bad\nidentity" } } },
    ])
      expect(() => parseTailscaleIdentity(value, config)).toThrow();
  });
});
describe("startup diagnostics and service template", () => {
  let directory: string;
  let config: Config;
  const executable = async (path: string, source: string) => {
    await writeFile(path, `#!${process.execPath}\n${source}`);
    await chmod(path, 0o700);
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "cmux-config-test-"));
    config = {
      ...readConfig({}),
      cmuxBinary: join(directory, "fake-cmux"),
      tailscaleBinary: join(directory, "fake-tailscale"),
      assetsDirectory: directory,
      stateDirectory: join(directory, "new-private-state"),
    };
    await executable(config.cmuxBinary, "console.log(JSON.stringify({workspaces:[]}));");
    await executable(
      config.tailscaleBinary,
      `console.log(${JSON.stringify(JSON.stringify(status))});`,
    );
    await writeFile(
      join(directory, "index.html"),
      '<html lang="en"><script type="module" src="/app.js"></script></html>',
    );
    await writeFile(join(directory, "app.js"), "// Test bundle");
    await writeFile(join(directory, "sw.js"), "");
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({ icons: [{ src: "/icon-192.png" }] }),
    );
    await writeFile(join(directory, "icon-192.png"), "fixture");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("checks fake authenticated cmux RPC, identity and assets without creating state", async () => {
    const before = await readdir(directory);
    const checks = await diagnose(config);
    expect(checks).toHaveLength(4);
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(await readdir(directory)).toEqual(before);
    expect(await discoverAccess(config)).toMatchObject({ allowedLogin: "owner@example.test" });
  });
  it("does not report invalid JSON or missing assets as ready", async () => {
    await executable(config.cmuxBinary, 'console.log("{}");');
    await executable(config.tailscaleBinary, 'console.log("not json");');
    await rm(join(directory, "icon-192.png"));
    const checks = await diagnose(config);
    expect(checks.filter((check) => !check.ok).map((check) => check.name)).toEqual([
      "cmux",
      "Tailscale",
      "Client assets",
    ]);
    await expect(checkAssets(directory)).rejects.toThrow("bun run build");
  });
  it("rejects a manifest icon that escapes the asset directory", async () => {
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({ icons: [{ src: "/../private.png" }] }),
    );
    await expect(checkAssets(directory)).rejects.toThrow();
  });
  it("rejects an index with a missing JavaScript bundle", async () => {
    await rm(join(directory, "app.js"));
    await expect(checkAssets(directory)).rejects.toThrow("bun run build");
  });
  it("only generates XML with resolved paths and no inherited credentials", () => {
    const template = serviceTemplate(config, process.execPath, "/tmp/release & test");
    expect(template).toContain("/tmp/release &amp; test/scripts/serve.ts");
    expect(template).toContain("<key>KeepAlive</key><true/>");
    expect(template).toContain("<key>ThrottleInterval</key><integer>30</integer>");
    expect(template).not.toContain("CMUX_SURFACE_ID");
    expect(template).not.toContain("PASSWORD");
    expect(() => serviceTemplate({ ...config, cmuxBinary: "/missing/executable" })).toThrow();
  });
});
