import { access, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { isRecord } from "../shared/protocol";
import { buildDirectory } from "./build";
import { checkAssets } from "./config";
import { publicFiles, repositoryRoot } from "./release-files";

const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".html",
  ".css",
  ".txt",
]);
export async function checkRelease() {
  const files = await publicFiles();
  const errors: string[] = [];
  for (const file of files) {
    if (!textExtensions.has(extname(file))) continue;
    const text = await readFile(join(repositoryRoot, file), "utf8");
    if (/[\p{Script=Cyrillic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)) {
      errors.push(`${file}: non-English source text`);
    }
    if (
      /\/Users\/(?!(?:example|user|test)(?:\/|\b))[^/\s"'`]+/.test(text) ||
      /https:\/\/login\.tailscale\.com\/f\/serve\?node=/.test(text) ||
      /\b[\w-]+\.tail[a-f0-9]{5,}\.ts\.net\b/i.test(text) ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
    ) {
      errors.push(`${file}: private machine or credential material`);
    }
    if (file.endsWith(".md")) {
      for (const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1];
        if (!target || /^(?:[a-z]+:|#)/i.test(target)) continue;
        const path = decodeURIComponent(target.split("#")[0] ?? "");
        if (!path) continue;
        const resolved = resolve(repositoryRoot, dirname(file), path);
        if (!resolved.startsWith(`${repositoryRoot}/`)) {
          errors.push(`${file}: link leaves the repository (${target})`);
          continue;
        }
        try {
          await access(resolved);
        } catch {
          errors.push(`${file}: missing local link (${target})`);
        }
      }
    }
  }
  await checkAssets(buildDirectory);
  const index = await readFile(join(buildDirectory, "index.html"), "utf8");
  if (!/<html\s+lang="en"/.test(index)) errors.push("Built HTML must declare English.");
  for (const match of index.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) {
    const asset = match[1];
    if (asset) {
      try {
        await access(join(buildDirectory, asset.slice(1)));
      } catch {
        errors.push(`Built HTML references a missing asset: ${asset}`);
      }
    }
  }
  for (const [name, size] of [
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["apple-touch-icon.png", 180],
    ["favicon.png", 32],
  ] as const) {
    const bytes = await readFile(join(buildDirectory, name));
    if (
      bytes.length < 24 ||
      bytes.readUInt32BE(0) !== 0x89504e47 ||
      bytes.readUInt32BE(16) !== size ||
      bytes.readUInt32BE(20) !== size
    ) {
      errors.push(`Invalid icon dimensions: ${name}`);
    }
  }
  const manifest: unknown = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  const bunVersion = (await readFile(join(repositoryRoot, ".bun-version"), "utf8")).trim();
  if (
    !isRecord(manifest) ||
    manifest.private !== true ||
    manifest.packageManager !== `bun@${bunVersion}`
  )
    errors.push("Root package metadata is incomplete.");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `Release checks passed: ${files.length} public files, English source, local links, and built assets.`,
  );
  return files;
}
if (import.meta.main) await checkRelease();
