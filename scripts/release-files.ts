import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const repositoryRoot = resolve(import.meta.dir, "..");
export const publicRoots = [
  ".bun-version",
  ".editorconfig",
  ".gitignore",
  ".github",
  "biome.json",
  "bun.lock",
  "package.json",
  "tsconfig.json",
  "README.md",
  "LICENSE",
  "LICENSES",
  "NOTICE.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "TRIAL.md",
  "client",
  "server",
  "shared",
  "scripts",
  "docs",
];
const excluded = new Set(["node_modules", "dist", ".git", ".state", ".release", "coverage"]);

export async function publicFiles(root = repositoryRoot): Promise<string[]> {
  const files: string[] = [];
  async function visit(relative: string) {
    const name = relative.split("/").at(-1) ?? "";
    if (
      excluded.has(name) ||
      name === ".DS_Store" ||
      name.startsWith("._") ||
      name.endsWith(".log") ||
      name.endsWith(".pid") ||
      (name.startsWith(".env") && name !== ".env.example") ||
      (name === "bun.lock" && relative !== "bun.lock")
    )
      return;
    const absolute = join(root, relative);
    const info = await lstat(absolute);
    if (info.isSymbolicLink())
      throw new Error(`Public source must not contain symlinks: ${relative}`);
    if (info.isDirectory()) {
      for (const entry of (await readdir(absolute)).sort()) await visit(`${relative}/${entry}`);
    } else if (info.isFile()) files.push(relative);
    else throw new Error(`Unsupported public source entry: ${relative}`);
  }
  for (const name of publicRoots) await visit(name);
  return files.sort();
}

export function validateArchiveMembers(listing: string, name: string, files: string[]): void {
  const expected = new Set([...files, "SOURCE-MANIFEST.json"].map((file) => `${name}/${file}`));
  const seen = new Set<string>();
  for (const member of listing.split("\n").filter(Boolean)) {
    if (member.endsWith("/")) {
      if (member !== `${name}/` && ![...expected].some((file) => file.startsWith(member)))
        throw new Error(`Unexpected archive directory: ${member}`);
      continue;
    }
    if (!expected.has(member) || seen.has(member))
      throw new Error(`Unexpected or duplicate archive member: ${member}`);
    seen.add(member);
  }
  if (seen.size !== expected.size) throw new Error("Source archive is missing expected files.");
}
