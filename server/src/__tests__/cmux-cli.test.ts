import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCmuxExecutor } from "../cmux-cli";
import { runProcess } from "../process";

describe("bounded native CLI adapter", () => {
  let directory: string;
  let binary: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "cmux-cli-test-"));
    binary = join(directory, "fake-cmux");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const fake = async (source: string) => {
    await writeFile(binary, `#!${process.execPath}\n${source}`);
    await chmod(binary, 0o700);
  };
  it("passes literal input in one JSON argv value without shell expansion", async () => {
    await fake("console.log(JSON.stringify({args:process.argv.slice(2)}));");
    const text = "--help; $(echo SHOULD_STAY_TEXT) `literal` café";
    expect(await createCmuxExecutor(binary)("surface.send_text", { text })).toEqual({
      args: ["rpc", "surface.send_text", JSON.stringify({ text })],
    });
  });
  it("rejects nonzero exits, malformed JSON and negative acknowledgements", async () => {
    for (const source of [
      'console.error("denied");process.exit(3);',
      'console.log("not json");',
      'console.log("null");',
      'console.log("[]");',
      "console.log(JSON.stringify({ok:false}));",
      'console.log(JSON.stringify({error:"failed"}));',
    ]) {
      await fake(source);
      await expect(createCmuxExecutor(binary)("workspace.list", {})).rejects.toThrow();
    }
  });
  it("times out and kills a stalled child", async () => {
    await fake("setInterval(()=>{},1000);");
    const started = Date.now();
    await expect(
      createCmuxExecutor(binary, { timeoutMs: 40 })("workspace.list", {}),
    ).rejects.toThrow("did not complete");
    expect(Date.now() - started).toBeLessThan(2000);
  });
  it("bounds process output and handles missing executables", async () => {
    await fake('console.log("x".repeat(1000));');
    await expect(runProcess(binary, [], { maxOutputBytes: 10 })).rejects.toThrow("allowed size");
    await expect(
      createCmuxExecutor(join(directory, "missing"))("workspace.list", {}),
    ).rejects.toMatchObject({ code: "upstream_unavailable" });
  });
});
