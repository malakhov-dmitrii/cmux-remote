import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const clientRequire = createRequire(resolve(root, "client/package.json"));
export const viteExecutable = resolve(
  dirname(clientRequire.resolve("vite/package.json")),
  "bin/vite.js",
);
export const buildDirectory = resolve(
  process.env.CMUX_REMOTE_BUILD_DIR ?? resolve(root, "client/dist"),
);

export async function buildClient() {
  await mkdir(buildDirectory, { recursive: true });
  const compiler = Bun.spawn(
    [
      process.execPath,
      resolve(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "-p",
      resolve(root, "client/tsconfig.json"),
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (await compiler.exited) throw new Error("Client type checking failed.");
  const bundler = Bun.spawn(
    [process.execPath, viteExecutable, "build", "--outDir", buildDirectory],
    { cwd: resolve(root, "client"), stdout: "inherit", stderr: "inherit" },
  );
  if (await bundler.exited) throw new Error("Client build failed.");
}

if (import.meta.main) await buildClient();
