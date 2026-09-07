import { createCmuxExecutor } from "../server/src/cmux-cli";
import { startBridge } from "../server/src/index";
import { InputState } from "../server/src/input-state";
import { parseWorkspaces } from "../shared/protocol";
import { checkAssets, discoverAccess, readConfig } from "./config";

export async function serve() {
  const config = readConfig();
  await checkAssets(config.assetsDirectory);
  const execute = createCmuxExecutor(config.cmuxBinary);
  try {
    parseWorkspaces(await execute("workspace.list", {}));
  } catch {
    throw new Error(
      "cmux access failed. Open cmux and run from its terminal, or configure native password-mode access before starting outside cmux. Run bun run doctor for details.",
    );
  }
  const access = await discoverAccess(config);
  const state = new InputState(config.stateDirectory);
  await state.prepare();
  const server = startBridge(access, config.port, execute, state);
  console.log(`Local: ${access.localOrigin}`);
  console.log(`Remote URL: ${access.remoteOrigin}`);
  console.log(
    `Configure Tailscale Serve if needed: tailscale serve --bg --https=${config.httpsPort} ${access.localOrigin}`,
  );
  console.log("Keep this process running. Ctrl+C stops the bridge.");
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.stop(true);
      process.exit(0);
    });
  }
  return server;
}
export async function main() {
  try {
    await serve();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The bridge could not start.");
    process.exitCode = 1;
  }
}
if (import.meta.main) await main();
