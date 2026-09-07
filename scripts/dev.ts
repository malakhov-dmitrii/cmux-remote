import { resolve } from "node:path";
import { buildClient, buildDirectory, viteExecutable } from "./build";

const root = resolve(import.meta.dir, "..");
if (buildDirectory !== resolve(root, "client/dist"))
  throw new Error("Development must build into client/dist. Unset CMUX_REMOTE_BUILD_DIR.");
await buildClient();
const processes = [
  Bun.spawn([process.execPath, "--watch", resolve(root, "scripts/serve.ts")], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn([process.execPath, viteExecutable, "build", "--watch", "--outDir", buildDirectory], {
    cwd: resolve(root, "client"),
    stdout: "inherit",
    stderr: "inherit",
  }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log("Watching server and client source. Reload the browser after a client rebuild.");
const exitCode = await Promise.race(processes.map((child) => child.exited));
stop();
await Promise.all(processes.map((child) => child.exited));
process.exitCode = exitCode;
