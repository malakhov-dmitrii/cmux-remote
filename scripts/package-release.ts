import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runProcess } from "../server/src/process";
import { isRecord } from "../shared/protocol";
import { checkRelease } from "./check-release";
import { repositoryRoot, validateArchiveMembers } from "./release-files";

const files = await checkRelease();
const manifest: unknown = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
if (
  !isRecord(manifest) ||
  typeof manifest.version !== "string" ||
  !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)
)
  throw new Error("A valid package version is required.");
const name = `cmux-remote-${manifest.version}`;
const releaseDirectory = join(repositoryRoot, ".release");
await mkdir(releaseDirectory, { recursive: true });
const temporary = await mkdtemp(join(releaseDirectory, ".stage-"));
const stage = join(temporary, name);
const archive = join(releaseDirectory, `${name}-source.tar.gz`);
try {
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const target = join(stage, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(repositoryRoot, file), target);
    hashes[file] = new Bun.CryptoHasher("sha256").update(await readFile(target)).digest("hex");
  }
  await writeFile(
    join(stage, "SOURCE-MANIFEST.json"),
    `${JSON.stringify({ version: manifest.version, files: hashes }, null, 2)}\n`,
  );
  await runProcess("tar", ["-czf", archive, "-C", temporary, name], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    timeoutMs: 30_000,
  });
  const listing = await runProcess("tar", ["-tzf", archive], { timeoutMs: 30_000 });
  validateArchiveMembers(listing, name, files);
  const checksum = new Bun.CryptoHasher("sha256").update(await readFile(archive)).digest("hex");
  await writeFile(`${archive}.sha256`, `${checksum}  ${name}-source.tar.gz\n`);
  console.log(`Created ${archive}`);
} finally {
  // Remove only the fresh staging directory created by this invocation.
  await rm(temporary, { recursive: true, force: true });
}
