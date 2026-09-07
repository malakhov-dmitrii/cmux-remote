// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteError, type RpcMethod } from "../../../shared/protocol";
import { useCreation } from "./useCreation";

const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const surface = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const created = {
  workspace_id: workspace,
  surface_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

function setup() {
  const current = { workspace, surface, revision: 0 };
  const rpc = vi.fn<(method: RpcMethod, params: Record<string, unknown>) => Promise<unknown>>();
  const onCreated = vi.fn();
  const hook = renderHook(() =>
    useCreation({
      connected: true,
      terminalAvailable: true,
      rpc,
      getSelection: () => current,
      onCreated,
    }),
  );
  return { ...hook, rpc, current, onCreated };
}

afterEach(cleanup);
describe("remote creation", () => {
  it("normalizes workspace options and blocks duplicate creation requests", async () => {
    const { result, rpc, onCreated } = setup();
    let complete: (value: unknown) => void = () => {};
    rpc.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    let first: Promise<boolean> | undefined;
    let duplicate: Promise<boolean> | undefined;
    act(() => {
      first = result.current.createWorkspace({ name: " Notes ", cwd: " ~/code " });
      duplicate = result.current.createWorkspace({ name: "Notes" });
    });
    expect(await duplicate).toBe(false);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("workspace.create", { name: "Notes", cwd: "~/code" });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      complete(created);
    });
    expect(await first).toBe(true);
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it("pins the terminal anchor and does not change selection after the user switches away and back", async () => {
    const { result, rpc, onCreated, current } = setup();
    let complete: (value: unknown) => void = () => {};
    rpc.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    act(() => {
      void result.current.createTerminal();
    });
    expect(rpc).toHaveBeenCalledWith("surface.create", {
      workspace_ref: workspace,
      surface_ref: surface,
    });
    current.revision += 2;
    await act(async () => {
      complete(created);
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(result.current.error).toBe(null);
  });

  it.each([
    new RemoteError("connection_closed", "Disconnected", "unknown"),
    new RemoteError("upstream_unavailable", "Timed out", "unknown"),
  ])("does not replay an uncertain creation: $code", async (error) => {
    const { result, rpc } = setup();
    rpc.mockRejectedValue(error);
    await act(async () => {
      expect(await result.current.createWorkspace({})).toBe(false);
    });
    expect(result.current.error?.delivery).toBe("unknown");
    expect(result.current.canCreateWorkspace).toBe(false);
    await act(async () => {
      expect(await result.current.createWorkspace({})).toBe(false);
    });
    expect(rpc).toHaveBeenCalledOnce();
    act(() => {
      result.current.acknowledgeError();
    });
    expect(result.current.canCreateWorkspace).toBe(true);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("treats invalid creation results as unknown and preserves the selected target", async () => {
    const { result, rpc, onCreated } = setup();
    rpc.mockResolvedValue({ workspace_id: workspace, surface_id: "surface:1" });
    await act(async () => {
      expect(await result.current.createWorkspace({})).toBe(false);
    });
    expect(result.current.error).toMatchObject({ code: "invalid_response", delivery: "unknown" });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("rejects a terminal response that names a different workspace", async () => {
    const { result, rpc, onCreated } = setup();
    rpc.mockResolvedValue({ ...created, workspace_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
    await act(async () => {
      expect(await result.current.createTerminal()).toBe(false);
    });
    expect(result.current.error).toMatchObject({ code: "invalid_response", delivery: "unknown" });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("rejects invalid workspace options before dispatch", async () => {
    const { result, rpc } = setup();
    await act(async () => {
      expect(await result.current.createWorkspace({ name: "bad\nname" })).toBe(false);
    });
    expect(result.current.error?.delivery).toBe("not_sent");
    expect(rpc).not.toHaveBeenCalled();
  });
});
