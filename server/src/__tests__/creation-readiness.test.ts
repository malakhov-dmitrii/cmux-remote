import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRpcRequest } from "../../../shared/protocol";
import { InputState } from "../input-state";
import { type Executor, handleRpc } from "../rpc";

const windowId = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const anchor = "33333333-3333-4333-8333-333333333333";
const pane = "44444444-4444-4444-8444-444444444444";
const newWorkspace = "55555555-5555-4555-8555-555555555555";
const newSurface = "66666666-6666-4666-8666-666666666666";
type Call = { method: string; params: Record<string, unknown> };

function fixture(read: Executor, replay?: Executor) {
  const calls: Call[] = [];
  let created = false;
  const execute: Executor = async (method, params) => {
    calls.push({ method, params });
    if (method === "workspace.list")
      return { window_id: windowId, workspaces: [{ id: workspace }] };
    if (method === "workspace.create" || method === "surface.create") {
      created = true;
      return {
        window_id: windowId,
        workspace_id: method === "workspace.create" ? newWorkspace : workspace,
        surface_id: newSurface,
        pane_id: pane,
        type: "terminal",
      };
    }
    if (method === "surface.list")
      return {
        window_id: windowId,
        workspace_id: params.workspace_id,
        surfaces: (created ? [anchor, newSurface] : [anchor]).map((id) => ({
          id,
          pane_id: pane,
          type: "terminal",
        })),
      };
    if (method === "terminal.replay")
      return replay
        ? replay(method, params)
        : {
            workspace_id: params.workspace_id,
            surface_id: params.surface_id,
            text: "discard this replay payload",
          };
    if (method === "surface.read_text") return read(method, params);
    throw new Error(`Unexpected native operation: ${method}`);
  };
  return { execute, calls };
}

describe("created terminal readiness", () => {
  let directory: string;
  let state: InputState;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "cmux-ready-test-"));
    state = new InputState(join(directory, "input-state"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const tabRequest = () =>
    createRpcRequest("surface.create", { workspace_ref: workspace, surface_ref: anchor });

  for (const method of ["workspace.create", "surface.create"] as const) {
    it(`warms ${method} with exact IDs and accepts an empty readable snapshot`, async () => {
      const { execute, calls } = fixture(async () => ({ text: "" }));
      const request =
        method === "workspace.create" ? createRpcRequest(method, { cwd: directory }) : tabRequest();
      const expectedWorkspace = method === "workspace.create" ? newWorkspace : workspace;
      const target = { workspace_id: expectedWorkspace, surface_id: newSurface };
      expect(await handleRpc(request, execute, state)).toMatchObject({ ok: true, result: target });
      expect(calls.slice(-2)).toEqual([
        { method: "terminal.replay", params: { window_id: windowId, ...target } },
        { method: "surface.read_text", params: { window_id: windowId, ...target, lines: 1 } },
      ]);
      expect(calls.filter((call) => call.method === method)).toHaveLength(1);
      expect(
        calls.some(
          (call) =>
            call.method.startsWith("surface.send") ||
            call.method.includes("focus") ||
            call.method.includes("viewport"),
        ),
      ).toBe(false);
    });
  }

  it("retries only snapshot reads when initialization is briefly unavailable", async () => {
    let reads = 0;
    const { execute, calls } = fixture(async () => {
      if (++reads === 1) throw new Error("Runtime is starting.");
      return { text: "ready" };
    });
    expect((await handleRpc(tabRequest(), execute, state)).ok).toBe(true);
    expect(reads).toBe(2);
    expect(calls.filter((call) => call.method === "surface.create")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "terminal.replay")).toHaveLength(1);
  });

  it("returns an unknown result after bounded attempts if the terminal never becomes readable", async () => {
    let reads = 0;
    const { execute, calls } = fixture(async () => {
      reads++;
      throw new Error("Still unavailable.");
    });
    const started = performance.now();
    expect(await handleRpc(tabRequest(), execute, state)).toMatchObject({
      ok: false,
      error: { delivery: "unknown" },
    });
    expect(reads).toBe(3);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(calls.filter((call) => call.method === "surface.create")).toHaveLength(1);
  });

  it("rejects a replay for another target before reading any snapshot", async () => {
    const { execute, calls } = fixture(
      async () => ({ text: "wrong" }),
      async () => ({ workspace_id: workspace, surface_id: anchor }),
    );
    expect(await handleRpc(tabRequest(), execute, state)).toMatchObject({
      ok: false,
      error: { code: "invalid_response", delivery: "unknown" },
    });
    expect(calls.some((call) => call.method === "surface.read_text")).toBe(false);
  });

  it("stops before replay when disconnect follows metadata readback", async () => {
    let active = true;
    let listings = 0;
    const { execute, calls } = fixture(async () => ({ text: "ready" }));
    const result = await handleRpc(
      tabRequest(),
      async (method, params) => {
        const value = await execute(method, params);
        if (method === "surface.list" && ++listings === 2) active = false;
        return value;
      },
      state,
      () => active,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "connection_closed", delivery: "unknown" },
    });
    expect(calls.some((call) => call.method === "terminal.replay")).toBe(false);
  });

  it("stops after replay or a failed read if the browser disconnects", async () => {
    for (const disconnectAt of ["replay", "read"]) {
      let active = true;
      const { execute, calls } = fixture(
        async () => {
          active = false;
          throw new Error("Disconnected.");
        },
        async (_method, params) => {
          if (disconnectAt === "replay") active = false;
          return { workspace_id: params.workspace_id, surface_id: params.surface_id };
        },
      );
      expect(await handleRpc(tabRequest(), execute, state, () => active)).toMatchObject({
        ok: false,
        error: { code: "connection_closed", delivery: "unknown" },
      });
      expect(calls.filter((call) => call.method === "surface.read_text")).toHaveLength(
        disconnectAt === "replay" ? 0 : 1,
      );
    }
  });
});
