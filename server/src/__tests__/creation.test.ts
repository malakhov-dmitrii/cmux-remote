import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createRpcRequest, isUuid, type RpcMethod } from "../../../shared/protocol";
import { InputState } from "../input-state";
import { type Executor, handleRpc } from "../rpc";

const windowId = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const anchor = "33333333-3333-4333-8333-333333333333";
const pane = "44444444-4444-4444-8444-444444444444";
const createdWorkspace = "55555555-5555-4555-8555-555555555555";
const createdSurface = "66666666-6666-4666-8666-666666666666";
const other = "77777777-7777-4777-8777-777777777777";
const workspaceList = {
  window_id: windowId,
  workspaces: [{ id: workspace, ref: "workspace:1", title: "Existing", index: 0 }],
};
const surfaces = (workspaceId = workspace, ids = [anchor]) => ({
  window_id: windowId,
  workspace_id: workspaceId,
  surfaces: ids.map((id) => ({
    id,
    pane_id: pane,
    type: "terminal",
    ref: "surface:1",
    title: "Shell",
  })),
});
const nativeCreated = {
  window_id: windowId,
  workspace_id: workspace,
  pane_id: pane,
  surface_id: createdSurface,
  type: "terminal",
};
const request = (method: RpcMethod, params: Record<string, unknown> = {}) =>
  createRpcRequest(method, params);
const tabRequest = () =>
  request("surface.create", { workspace_ref: workspace, surface_ref: anchor });

describe("remote creation", () => {
  let directory: string;
  let state: InputState;
  const invoke: typeof handleRpc = (value, execute, _state, active) =>
    handleRpc(value, execute, state, active);
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "cmux-create-test-"));
    state = new InputState(join(directory, "input-state"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("pins workspace creation to a fresh window and forwards only native fields", async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const execute: Executor = async (method, params) => {
      calls.push({ method, params });
      if (method === "workspace.list") return { window_id: windowId, workspaces: [] };
      if (method === "workspace.create")
        return { window_id: windowId, workspace_id: createdWorkspace, surface_id: createdSurface };
      if (method === "terminal.replay")
        return { workspace_id: createdWorkspace, surface_id: createdSurface };
      if (method === "surface.read_text") return { text: "" };
      return surfaces(createdWorkspace, [createdSurface]);
    };
    const response = await invoke(
      request("workspace.create", {
        name: " My workspace ",
        cwd: directory,
        command: "ignored",
        focus: true,
      }),
      execute,
    );
    expect(response).toMatchObject({
      ok: true,
      result: { workspace_id: createdWorkspace, surface_id: createdSurface },
    });
    expect(calls.map((call) => call.method)).toEqual([
      "workspace.list",
      "workspace.create",
      "surface.list",
      "terminal.replay",
      "surface.read_text",
    ]);
    const params = calls[1]?.params;
    expect(params).toMatchObject({
      window_id: windowId,
      title: "My workspace",
      working_directory: directory,
      focus: false,
    });
    expect(isUuid(params?.operation_id)).toBe(true);
    expect(Object.keys(params ?? {}).sort()).toEqual([
      "focus",
      "operation_id",
      "title",
      "window_id",
      "working_directory",
    ]);
  });

  it("uses the home folder for blank values and expands tilde paths", async () => {
    for (const cwd of [undefined, " ", "~", "~/"]) {
      const execute: Executor = async (method, params) => {
        if (method === "workspace.list") return workspaceList;
        if (method === "workspace.create") {
          expect(params.working_directory).toBe(homedir());
          expect(params.title).toBeUndefined();
          return { window_id: windowId, workspace_id: createdWorkspace, surface_id: null };
        }
        if (method === "terminal.replay")
          return { workspace_id: createdWorkspace, surface_id: createdSurface };
        if (method === "surface.read_text") return { text: "" };
        return surfaces(createdWorkspace, [createdSurface]);
      };
      expect((await invoke(request("workspace.create", { cwd }), execute)).ok).toBe(true);
    }
  });

  it("rejects invalid directories before any native operation", async () => {
    const file = join(directory, "file");
    await writeFile(file, "fixture");
    for (const cwd of ["relative/path", join(directory, "missing"), file]) {
      let calls = 0;
      const response = await invoke(request("workspace.create", { cwd }), async () => {
        calls++;
        return {};
      });
      expect(response).toMatchObject({
        ok: false,
        error: { code: "invalid_request", delivery: "not_sent" },
      });
      expect(calls).toBe(0);
    }
  });

  it("resolves the anchor pane and verifies created terminal membership", async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    let reads = 0;
    const execute: Executor = async (method, params) => {
      calls.push({ method, params });
      if (method === "surface.list")
        return surfaces(workspace, ++reads === 1 ? [anchor] : [anchor, createdSurface]);
      if (method === "workspace.list") return workspaceList;
      if (method === "surface.read_text") return { text: "" };
      return nativeCreated;
    };
    expect(await invoke(tabRequest(), execute)).toMatchObject({
      ok: true,
      result: { workspace_id: workspace, surface_id: createdSurface },
    });
    expect(calls).toEqual([
      { method: "surface.list", params: { workspace_id: workspace } },
      { method: "workspace.list", params: { window_id: windowId } },
      {
        method: "surface.create",
        params: {
          window_id: windowId,
          workspace_id: workspace,
          pane_id: pane,
          type: "terminal",
          focus: false,
        },
      },
      { method: "surface.list", params: { workspace_id: workspace } },
      {
        method: "terminal.replay",
        params: { window_id: windowId, workspace_id: workspace, surface_id: createdSurface },
      },
      {
        method: "surface.read_text",
        params: {
          window_id: windowId,
          workspace_id: workspace,
          surface_id: createdSurface,
          lines: 1,
        },
      },
    ]);
  });

  it("never forwards malformed, absent, foreign or remote anchor metadata", async () => {
    const invalidLists = [
      { ...surfaces(), window_id: "window:1" },
      { ...surfaces(), workspace_id: other },
      { ...surfaces(), surfaces: [] },
      { ...surfaces(), surfaces: [{ id: anchor, pane_id: "pane:1", type: "terminal" }] },
      { ...surfaces(), surfaces: [{ id: anchor, type: "terminal" }] },
      { ...surfaces(), surfaces: [{ id: anchor, pane_id: pane, type: "browser" }] },
    ];
    for (const listing of invalidLists) {
      const calls: string[] = [];
      const response = await invoke(tabRequest(), async (method) => {
        calls.push(method);
        return method === "surface.list" ? listing : workspaceList;
      });
      expect(response).toMatchObject({ ok: false, error: { delivery: "not_sent" } });
      expect(calls).not.toContain("surface.create");
    }
    for (const listing of [
      { ...workspaceList, workspaces: [] },
      { ...workspaceList, window_id: other },
      {
        ...workspaceList,
        workspaces: [{ ...workspaceList.workspaces[0], remote: { enabled: true } }],
      },
    ]) {
      const calls: string[] = [];
      const response = await invoke(tabRequest(), async (method) => {
        calls.push(method);
        return method === "surface.list" ? surfaces() : listing;
      });
      expect(response).toMatchObject({ ok: false, error: { delivery: "not_sent" } });
      expect(calls).not.toContain("surface.create");
    }
  });

  it("rejects duplicate creation while validation is pending without queueing", async () => {
    let release!: () => void;
    let reached!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let reads = 0;
    const execute: Executor = async (method) => {
      if (method === "workspace.list") {
        reached();
        await barrier;
        return workspaceList;
      }
      if (method === "surface.list")
        return surfaces(workspace, ++reads === 1 ? [anchor] : [anchor, createdSurface]);
      if (method === "surface.read_text") return { text: "" };
      return nativeCreated;
    };
    const first = invoke(tabRequest(), execute);
    await entered;
    expect(await invoke(tabRequest(), execute)).toMatchObject({
      ok: false,
      error: { code: "busy", delivery: "not_sent" },
    });
    release();
    expect((await first).ok).toBe(true);
  });

  it("does not mutate after disconnect during preflight and marks post-dispatch disconnect unknown", async () => {
    for (const disconnectAfterCreate of [false, true]) {
      let active = true;
      const calls: string[] = [];
      const response = await invoke(
        tabRequest(),
        async (method) => {
          calls.push(method);
          if (method === "surface.list") return surfaces();
          if (method === "workspace.list") {
            if (!disconnectAfterCreate) active = false;
            return workspaceList;
          }
          active = false;
          return nativeCreated;
        },
        undefined,
        () => active,
      );
      expect(response).toMatchObject({
        ok: false,
        error: {
          code: "connection_closed",
          delivery: disconnectAfterCreate ? "unknown" : "not_sent",
        },
      });
      expect(calls.filter((method) => method === "surface.create")).toHaveLength(
        disconnectAfterCreate ? 1 : 0,
      );
    }
  });

  it("leaves malformed or routed creation outcomes uncertain without retry or deletion", async () => {
    for (const result of [
      null,
      {},
      { accepted: true, routed: true, surface_id: null },
      { ...nativeCreated, surface_id: "surface:2" },
      { ...nativeCreated, surface_id: anchor },
      { ...nativeCreated, window_id: other },
      { ...nativeCreated, workspace_id: other },
      { ...nativeCreated, pane_id: other },
      { ...nativeCreated, type: "browser" },
    ]) {
      const calls: string[] = [];
      const response = await invoke(tabRequest(), async (method) => {
        calls.push(method);
        if (method === "surface.list") return surfaces();
        if (method === "workspace.list") return workspaceList;
        return result;
      });
      expect(response).toMatchObject({ ok: false, error: { delivery: "unknown" } });
      expect(calls.filter((method) => method === "surface.create")).toHaveLength(1);
      expect(
        calls.every((method) =>
          ["workspace.list", "surface.list", "surface.create"].includes(method),
        ),
      ).toBe(true);
    }
  });

  it("requires the new terminal in the exact workspace and pane readback before acknowledgement", async () => {
    for (const readback of [
      surfaces(),
      { ...surfaces(workspace, [createdSurface]), window_id: other },
      {
        ...surfaces(workspace, [createdSurface]),
        surfaces: [{ id: createdSurface, pane_id: other, type: "terminal" }],
      },
    ]) {
      let reads = 0;
      const response = await invoke(tabRequest(), async (method) => {
        if (method === "surface.list") return ++reads === 1 ? surfaces() : readback;
        if (method === "workspace.list") return workspaceList;
        return nativeCreated;
      });
      expect(response).toMatchObject({ ok: false, error: { delivery: "unknown" } });
    }
  });
});
