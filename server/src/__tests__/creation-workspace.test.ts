import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRpcRequest, RemoteError } from "../../../shared/protocol";
import { createCmuxExecutor } from "../cmux-cli";
import { InputState } from "../input-state";
import { handleRpc } from "../rpc";

const windowId = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const surface = "33333333-3333-4333-8333-333333333333";
const pane = "44444444-4444-4444-8444-444444444444";
const other = "55555555-5555-4555-8555-555555555555";
const created = { window_id: windowId, workspace_id: workspace, surface_id: surface };
const listing = {
  window_id: windowId,
  workspace_id: workspace,
  surfaces: [{ id: surface, pane_id: pane, type: "terminal" }],
};

describe("workspace creation failure boundaries", () => {
  let directory: string;
  let state: InputState;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "cmux-workspace-test-"));
    state = new InputState(join(directory, "input-state"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects missing or malformed window identity without creating anything", async () => {
    for (const value of [
      null,
      {},
      { window_id: "window:1", workspaces: [] },
      { window_id: windowId, workspaces: [{ id: "workspace:1" }] },
    ]) {
      const calls: string[] = [];
      const result = await handleRpc(
        createRpcRequest("workspace.create", { cwd: directory }),
        async (method) => {
          calls.push(method);
          return value;
        },
        state,
      );
      expect(result).toMatchObject({ ok: false, error: { delivery: "not_sent" } });
      expect(calls).toEqual(["workspace.list"]);
    }
  });

  it("does not acknowledge missing, mismatched or reused native creation IDs", async () => {
    for (const value of [
      null,
      {},
      { ...created, window_id: other },
      { ...created, workspace_id: other },
      { ...created, surface_id: "surface:1" },
      { ...created, surface_id: undefined },
    ]) {
      const calls: string[] = [];
      const result = await handleRpc(
        createRpcRequest("workspace.create", { cwd: directory }),
        async (method) => {
          calls.push(method);
          if (method === "workspace.list")
            return { window_id: windowId, workspaces: [{ id: other }] };
          if (method === "workspace.create") return value;
          return listing;
        },
        state,
      );
      expect(result).toMatchObject({ ok: false, error: { delivery: "unknown" } });
      expect(calls.filter((method) => method === "workspace.create")).toHaveLength(1);
    }
  });

  it("requires a terminal in readback and treats post-dispatch errors as unknown", async () => {
    for (const value of [
      { ...listing, surfaces: [] },
      { ...listing, window_id: other },
      { ...listing, workspace_id: other },
      { ...listing, surfaces: [{ id: surface, pane_id: pane, type: "browser" }] },
    ]) {
      const result = await handleRpc(
        createRpcRequest("workspace.create", { cwd: directory }),
        async (method) => {
          if (method === "workspace.list") return { window_id: windowId, workspaces: [] };
          if (method === "workspace.create") return created;
          return value;
        },
        state,
      );
      expect(result).toMatchObject({ ok: false, error: { delivery: "unknown" } });
    }
    const result = await handleRpc(
      createRpcRequest("workspace.create", { cwd: directory }),
      async (method) => {
        if (method === "workspace.list") return { window_id: windowId, workspaces: [] };
        throw new RemoteError("upstream_error", "Native reply was lost.", "not_sent");
      },
      state,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "upstream_error", delivery: "unknown" },
    });
  });

  it("uses literal native RPC argv through the real CLI adapter", async () => {
    const binary = join(directory, "fake-cmux");
    const log = join(directory, "calls.jsonl");
    await writeFile(
      binary,
      `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\nconst args=process.argv.slice(2);\nappendFileSync(process.env.CREATION_TEST_LOG,JSON.stringify({args,params:JSON.parse(args[2])})+"\\n");\nconst results=${JSON.stringify({ "workspace.list": { window_id: windowId, workspaces: [] }, "workspace.create": created, "surface.list": listing, "terminal.replay": { workspace_id: workspace, surface_id: surface }, "surface.read_text": { text: "" } })};\nconsole.log(JSON.stringify(results[args[1]]));\n`,
    );
    await chmod(binary, 0o700);
    const title = "literal; $(do-not-run) `text`";
    const execute = createCmuxExecutor(binary, { env: { ...process.env, CREATION_TEST_LOG: log } });
    expect(
      await handleRpc(
        createRpcRequest("workspace.create", { name: title, cwd: directory }),
        execute,
        state,
      ),
    ).toMatchObject({ ok: true, result: { workspace_id: workspace, surface_id: surface } });
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line): unknown => JSON.parse(line));
    expect(calls).toHaveLength(5);
    expect(calls[0]).toEqual({ args: ["rpc", "workspace.list", "{}"], params: {} });
    expect(calls[1]).toMatchObject({
      args: ["rpc", "workspace.create", expect.any(String)],
      params: {
        window_id: windowId,
        title,
        working_directory: directory,
        focus: false,
        operation_id: expect.any(String),
      },
    });
    expect(calls[2]).toEqual({
      args: ["rpc", "surface.list", JSON.stringify({ workspace_id: workspace })],
      params: { workspace_id: workspace },
    });
    const routing = { window_id: windowId, workspace_id: workspace, surface_id: surface };
    expect(calls[3]).toEqual({
      args: ["rpc", "terminal.replay", JSON.stringify(routing)],
      params: routing,
    });
    expect(calls[4]).toEqual({
      args: ["rpc", "surface.read_text", JSON.stringify({ ...routing, lines: 1 })],
      params: { ...routing, lines: 1 },
    });
  });
});
