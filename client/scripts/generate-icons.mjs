import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { IconTerminal2 } from "@tabler/icons-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const publicDirectory = new URL("../public/", import.meta.url);
await mkdir(publicDirectory, { recursive: true });
const icon = renderToStaticMarkup(
  createElement(
    IconTerminal2,
    { size: 512, stroke: 1.5, color: "#9bcbb8", role: "img", "aria-labelledby": "icon-title" },
    createElement("title", { id: "icon-title" }, "cmux Remote"),
  ),
);
const svg = new URL("icon.svg", publicDirectory);
await Bun.write(svg, `${icon}\n`);
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["favicon.png", 32],
]) {
  const output = new URL(name, publicDirectory);
  const process = Bun.spawn(
    [
      "magick",
      "-background",
      "#0d1117",
      fileURLToPath(svg),
      "-resize",
      `${size}x${size}`,
      "-alpha",
      "remove",
      "-alpha",
      "off",
      fileURLToPath(output),
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (await process.exited) throw new Error("Icon generation requires ImageMagick 7.");
}
console.log("Generated SVG, PWA, Apple touch, and favicon assets from Tabler Terminal2.");
