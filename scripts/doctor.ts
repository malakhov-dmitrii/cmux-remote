import { lstat } from "node:fs/promises";
import { createCmuxExecutor } from "../server/src/cmux-cli";
import { parseWorkspaces } from "../shared/protocol";
import { type Config, checkAssets, discoverAccess, readConfig } from "./config";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}
export async function diagnose(config: Config): Promise<DoctorCheck[]> {
  const check = async (name: string, work: () => Promise<string>): Promise<DoctorCheck> => {
    try {
      return { name, ok: true, detail: await work() };
    } catch (error) {
      return { name, ok: false, detail: error instanceof Error ? error.message : "Check failed." };
    }
  };
  return Promise.all([
    check("cmux", async () => {
      const workspaces = parseWorkspaces(
        await createCmuxExecutor(config.cmuxBinary)("workspace.list", {}),
      );
      return `Authenticated RPC is available (${workspaces.length} workspaces).`;
    }),
    check("Tailscale", async () => {
      await discoverAccess(config);
      return "A running user-owned Tailscale device with a .ts.net name is available. Serve routing is not checked.";
    }),
    check("Client assets", async () => {
      await checkAssets(config.assetsDirectory);
      return "Built client and manifest icons are available.";
    }),
    check("Recovery storage", async () => {
      try {
        const stat = await lstat(config.stateDirectory);
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          (stat.mode & 0o777) !== 0o700 ||
          (typeof process.getuid === "function" && stat.uid !== process.getuid())
        )
          throw new Error("State directory must be owned by this user with permissions 0700.");
        return "Private state directory exists. Write access is checked at startup.";
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT")
          return "State directory will be created at startup. Doctor made no changes.";
        throw error;
      }
    }),
  ]);
}
export async function doctorMain() {
  try {
    const config = readConfig();
    console.log(
      `Configuration: loopback port ${config.port}; Tailscale HTTPS port ${config.httpsPort}.`,
    );
    const checks = await diagnose(config);
    for (const check of checks)
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
    if (checks.some((check) => !check.ok)) {
      console.log(
        "For cmux access failures, open cmux and run from its terminal, or configure native password-mode access before running outside cmux.",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid configuration.");
    process.exitCode = 1;
  }
}
if (import.meta.main) await doctorMain();
