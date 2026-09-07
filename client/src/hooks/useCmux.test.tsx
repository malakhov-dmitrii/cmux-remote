// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcError } from "../../../shared/protocol";
import { useCmux } from "./useCmux";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SURFACE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SURFACE_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
interface Request {
  version: number;
  id: string;
  method: string;
  params: Record<string, unknown>;
}

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  requests: Request[] = [];
  constructor() {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.requests.push(JSON.parse(data));
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  reply(request: Request, result: unknown) {
    this.onmessage?.({ data: JSON.stringify({ id: request.id, ok: true, result }) });
  }
  fail(
    request: Request,
    error: RpcError = { code: "upstream_error", message: "Unavailable", delivery: "unknown" },
  ) {
    this.onmessage?.({ data: JSON.stringify({ id: request.id, ok: false, error }) });
  }
  take(method: string) {
    const request = this.requests.find((entry) => entry.method === method);
    if (!request) throw new Error(`Missing ${method}: ${JSON.stringify(this.requests)}`);
    this.requests.splice(this.requests.indexOf(request), 1);
    return request;
  }
}

const workspaces = [
  { id: WORKSPACE_A, ref: "workspace:1", title: "Alpha", selected: true, index: 0 },
  { id: WORKSPACE_B, ref: "workspace:2", title: "Beta", index: 1 },
];
const surfaces = [
  { id: SURFACE_A, ref: "surface:1", type: "terminal", title: "Shell A", index: 0 },
  { id: SURFACE_B, ref: "surface:2", type: "terminal", title: "Shell B", index: 1 },
];

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function latestSocket(): FakeSocket {
  return required(FakeSocket.instances[FakeSocket.instances.length - 1], "fixture socket");
}

function savedSelection(key: string): unknown {
  return JSON.parse(required(window.sessionStorage.getItem(key), "saved selection"));
}

async function answer(socket: FakeSocket, method: string, result: unknown) {
  const request = socket.take(method);
  await act(async () => {
    socket.reply(request, result);
  });
  return request;
}

async function start() {
  const hook = renderHook(() => useCmux());
  const socket = latestSocket();
  await act(async () => {
    socket.open();
  });
  await answer(socket, "workspace.list", { workspaces });
  await answer(socket, "surface.list", { surfaces });
  return { ...hook, socket };
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("remote target and input", () => {
  it("submits through one versioned RPC with immutable target IDs", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    let submission: Promise<boolean> | undefined;
    let duplicate: Promise<boolean> | undefined;
    act(() => {
      submission = result.current.submitText("hello");
      duplicate = result.current.submitText("hello");
    });
    expect(await required(duplicate, "duplicate action")).toBe(false);
    expect(result.current.sending).toBe(true);
    act(() => {
      result.current.selectWorkspace(WORKSPACE_B);
    });
    const textRequest = await answer(socket, "surface.submit", {});
    expect(textRequest.version).toBe(1);
    expect(textRequest.params).toEqual({
      workspace_ref: WORKSPACE_A,
      surface_ref: SURFACE_A,
      text: "hello",
    });
    expect(
      socket.requests.some(
        (request) =>
          request.method === "surface.send_key" || request.method === "surface.send_text",
      ),
    ).toBe(false);
    expect(await required(submission, "submission action")).toBe(true);
    expect(result.current.sending).toBe(false);
    expect(result.current.currentWorkspace).toBe(WORKSPACE_B);
  });

  it("keeps a fresh target locked until the whole submit is confirmed", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    act(() => {
      void result.current.submitText("hello");
    });
    expect(result.current.fresh).toBe(true);
    let duplicate: Promise<boolean> | undefined;
    act(() => {
      duplicate = result.current.submitText("hello");
    });
    expect(await required(duplicate, "duplicate action")).toBe(false);
    expect(
      socket.requests.filter((request) => request.method === "surface.send_text"),
    ).toHaveLength(0);
    expect(socket.requests.filter((request) => request.method === "surface.submit")).toHaveLength(
      1,
    );
    await answer(socket, "surface.submit", {});
  });

  it("does not attempt extra input after a submit is rejected before delivery", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    let submission: Promise<boolean> | undefined;
    act(() => {
      submission = result.current.submitText("hello");
    });
    await act(async () => {
      socket.fail(socket.take("surface.submit"), {
        code: "busy",
        message: "Another writer is active.",
        delivery: "not_sent",
      });
    });
    expect(await required(submission, "submission action")).toBe(false);
    expect(socket.requests.some((request) => request.method === "surface.send_key")).toBe(false);
    expect(result.current.inputError?.delivery).toBe("not_sent");
  });

  it("does not continue a timed-out submit when a late text acknowledgement arrives", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    let submission: Promise<boolean> | undefined;
    act(() => {
      submission = result.current.submitText("hello");
    });
    const textRequest = socket.take("surface.submit");
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(await required(submission, "submission action")).toBe(false);
    await act(async () => {
      socket.reply(textRequest, {});
    });
    expect(socket.requests.some((request) => request.method === "surface.send_key")).toBe(false);
  });

  it("records an unconfirmed Enter as partial delivery on the original terminal", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    let submission: Promise<boolean> | undefined;
    act(() => {
      submission = result.current.submitText("hello");
    });
    act(() => {
      result.current.selectSurface(SURFACE_B);
    });
    await act(async () => {
      socket.fail(socket.take("surface.submit"), {
        code: "upstream_error",
        message: "Diagnostic copy can change.",
        delivery: "text_inserted",
      });
    });
    expect(await required(submission, "submission action")).toBe(false);
    expect(result.current.inputError).toBe(null);
    act(() => {
      result.current.selectSurface(SURFACE_A);
    });
    expect(result.current.inputError?.delivery).toBe("text_inserted");
    expect(result.current.canInput).toBe(false);
  });

  it("never replays a submit when the connection closes before its acknowledgement", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    let submission: Promise<boolean> | undefined;
    act(() => {
      submission = result.current.submitText("hello");
    });
    socket.take("surface.submit");
    await act(async () => {
      socket.close();
    });
    expect(await required(submission, "submission action")).toBe(false);
    expect(socket.requests.some((request) => request.method === "surface.send_key")).toBe(false);
    expect(result.current.inputError?.delivery).toBe("unknown");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    const reconnected = latestSocket();
    await act(async () => {
      reconnected.open();
    });
    expect(
      reconnected.requests.some(
        (request) =>
          request.method === "surface.send_key" ||
          request.method === "surface.send_text" ||
          request.method === "surface.submit",
      ),
    ).toBe(false);
  });

  it("exposes the actual last successful read time and clears it on target changes", async () => {
    const { result, socket } = await start();
    expect(result.current.lastReadAt).toBe(null);
    await answer(socket, "surface.read_text", { text: "prompt" });
    expect(result.current.lastReadAt).toBe(Date.now());
    const readAt = result.current.lastReadAt;
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.lastReadAt).toBe(readAt);
    expect(result.current.fresh).toBe(false);
    act(() => {
      result.current.selectSurface(SURFACE_B);
    });
    expect(result.current.lastReadAt).toBe(null);
  });

  it("reads and sends only explicit stable targets; Enter is a separate request", async () => {
    const { result, socket } = await start();
    const read = await answer(socket, "surface.read_text", { text: "alpha prompt" });
    expect(read.params).toEqual({ workspace_ref: WORKSPACE_A, surface_ref: SURFACE_A });
    expect(result.current.canInput).toBe(true);
    let send: Promise<boolean> | undefined;
    act(() => {
      send = result.current.sendText("hello");
    });
    const sent = await answer(socket, "surface.send_text", {});
    expect(sent.params).toEqual({
      workspace_ref: WORKSPACE_A,
      surface_ref: SURFACE_A,
      text: "hello",
    });
    expect(await required(send, "send action")).toBe(true);
    expect(socket.requests.some((request) => request.method === "surface.send_key")).toBe(false);
    act(() => {
      void result.current.sendKey("enter");
    });
    expect(socket.take("surface.send_key").params).toEqual({
      workspace_ref: WORKSPACE_A,
      surface_ref: SURFACE_A,
      key: "enter",
    });
  });

  it("discards an old snapshot after switching workspaces and never changes Mac focus", async () => {
    const { result, socket } = await start();
    act(() => {
      result.current.selectWorkspace(WORKSPACE_B);
    });
    expect(result.current.canInput).toBe(false);
    await answer(socket, "surface.read_text", { text: "WRONG OLD OUTPUT" });
    expect(result.current.content).toBe("");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces });
    const list = await answer(socket, "surface.list", { surfaces: [surfaces[1]] });
    expect(list.params.workspace_ref).toBe(WORKSPACE_B);
    const read = await answer(socket, "surface.read_text", { text: "beta output" });
    expect(read.params).toEqual({ workspace_ref: WORKSPACE_B, surface_ref: SURFACE_B });
    expect(result.current.content).toBe("beta output");
    expect(result.current.canInput).toBe(true);
    expect(socket.requests.some((request) => /focus|select/.test(request.method))).toBe(false);
  });

  it("ignores a surface-list result for a workspace that is no longer selected", async () => {
    const hook = renderHook(() => useCmux());
    const socket = latestSocket();
    await act(async () => {
      socket.open();
    });
    await answer(socket, "workspace.list", { workspaces });
    expect(hook.result.current.surfacesLoaded).toBe(false);
    act(() => {
      hook.result.current.selectWorkspace(WORKSPACE_B);
    });
    await answer(socket, "surface.list", { surfaces });
    expect(hook.result.current.surfaces).toEqual([]);
    expect(hook.result.current.surfacesLoaded).toBe(false);
    expect(socket.requests.some((request) => request.method === "surface.read_text")).toBe(false);
  });

  it("resets terminal-list readiness on workspace selection and confirms an empty response", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    expect(result.current.surfacesLoaded).toBe(true);
    act(() => {
      result.current.selectWorkspace(WORKSPACE_B);
    });
    expect(result.current.surfacesLoaded).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces });
    expect(result.current.surfacesLoaded).toBe(false);
    await answer(socket, "surface.list", { surfaces: [] });
    expect(result.current.surfacesLoaded).toBe(true);
    expect(result.current.surfaces).toEqual([]);
  });

  it("discards a previous terminal snapshot when switching surfaces", async () => {
    const { result, socket } = await start();
    act(() => {
      result.current.selectSurface(SURFACE_B);
    });
    await answer(socket, "surface.read_text", { text: "old terminal" });
    expect(result.current.content).toBe("");
    expect(result.current.canInput).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces });
    await answer(socket, "surface.list", { surfaces });
    const read = await answer(socket, "surface.read_text", { text: "new terminal" });
    expect(read.params.surface_ref).toBe(SURFACE_B);
    expect(result.current.content).toBe("new terminal");
  });

  it("requires an explicit selection after the current terminal closes", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces });
    await answer(socket, "surface.list", { surfaces: [surfaces[1]] });
    expect(result.current.currentSurface).toBe(null);
    expect(result.current.canInput).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces });
    await answer(socket, "surface.list", { surfaces: [surfaces[1]] });
    expect(result.current.currentSurface).toBe(null);
    expect(socket.requests.some((request) => request.method === "surface.read_text")).toBe(false);
    act(() => {
      result.current.selectSurface(SURFACE_B);
    });
    expect(result.current.currentSurface).toBe(SURFACE_B);
  });

  it("does not replace a closed workspace with the Mac's focused workspace", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces: [workspaces[1]] });
    expect(result.current.currentWorkspace).toBe(null);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces: [workspaces[1]] });
    expect(result.current.currentWorkspace).toBe(null);
    expect(result.current.canInput).toBe(false);
    expect(socket.requests.some((request) => request.method === "surface.list")).toBe(false);
  });

  it("blocks duplicate sends and requires confirmed recovery after an uncertain result", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    let first: Promise<boolean> | undefined;
    let duplicate: Promise<boolean> | undefined;
    act(() => {
      first = result.current.sendText("hello");
      duplicate = result.current.sendText("hello");
    });
    expect(await required(duplicate, "duplicate action")).toBe(false);
    expect(
      socket.requests.filter((request) => request.method === "surface.send_text"),
    ).toHaveLength(1);
    await act(async () => {
      socket.fail(socket.take("surface.send_text"));
    });
    expect(await required(first, "first action")).toBe(false);
    expect(result.current.canInput).toBe(false);
    expect(result.current.inputError).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces });
    await answer(socket, "surface.list", { surfaces });
    await answer(socket, "surface.read_text", { text: "check this output" });
    expect(result.current.canInput).toBe(false);
    act(() => {
      result.current.acknowledgeInputError();
    });
    expect(result.current.canInput).toBe(false);
    expect(result.current.canRecover).toBe(true);
    let recovered: Promise<boolean> | undefined;
    act(() => {
      recovered = result.current.recoverInput();
    });
    expect(result.current.inputError).toBeTruthy();
    const recovery = await answer(socket, "surface.send_key", {});
    expect(recovery.params).toEqual({
      workspace_ref: WORKSPACE_A,
      surface_ref: SURFACE_A,
      key: "ctrl+c",
      confirmRecovery: true,
    });
    expect(await required(recovered, "recovered action")).toBe(true);
    expect(result.current.inputError).toBe(null);
    expect(result.current.canInput).toBe(true);
    expect(socket.requests.some((request) => request.method === "surface.send_text")).toBe(false);
  });

  it("fails pending input immediately on disconnect and never replays it", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    let pending: Promise<boolean> | undefined;
    act(() => {
      pending = result.current.sendText("hello");
    });
    await act(async () => {
      socket.close();
    });
    expect(await required(pending, "pending action")).toBe(false);
    expect(result.current.canInput).toBe(false);
    expect(result.current.inputError).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    const reconnected = latestSocket();
    await act(async () => {
      reconnected.open();
    });
    expect(reconnected.requests.some((request) => request.method === "surface.send_text")).toBe(
      false,
    );
  });

  it("rejects an id-only success envelope and requires explicit recovery", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    let submission: Promise<boolean> | undefined;
    act(() => {
      submission = result.current.submitText("hello");
    });
    const request = socket.take("surface.submit");
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({ id: request.id }) });
    });
    expect(await required(submission, "submission action")).toBe(false);
    expect(result.current.inputError).toMatchObject({
      code: "invalid_response",
      delivery: "unknown",
    });
    expect(result.current.canInput).toBe(false);
    expect(result.current.recoveryRequired).toBe(true);
  });

  it("allows local acknowledgement only for a confirmed non-delivery error", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    act(() => {
      void result.current.submitText("hello");
    });
    await act(async () => {
      socket.fail(socket.take("surface.submit"), {
        code: "busy",
        message: "Another client is writing.",
        delivery: "not_sent",
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces });
    await answer(socket, "surface.list", { surfaces });
    await answer(socket, "surface.read_text", { text: "fresh prompt" });
    expect(result.current.canAcknowledgeInputError).toBe(true);
    expect(result.current.canRecover).toBe(false);
    act(() => {
      result.current.acknowledgeInputError();
    });
    expect(result.current.canInput).toBe(true);
    expect(socket.requests.some((request) => request.method === "surface.send_key")).toBe(false);
  });

  it("keeps recovery required when an explicit interruption is rejected before delivery", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    act(() => {
      void result.current.submitText("hello");
    });
    await act(async () => {
      socket.fail(socket.take("surface.submit"), {
        code: "recovery_required",
        message: "Earlier input is unresolved.",
        delivery: "not_sent",
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces });
    await answer(socket, "surface.list", { surfaces });
    await answer(socket, "surface.read_text", { text: "check output" });
    act(() => {
      void result.current.recoverInput();
    });
    await act(async () => {
      socket.fail(socket.take("surface.send_key"), {
        code: "busy",
        message: "Another client is writing.",
        delivery: "not_sent",
      });
    });
    expect(result.current.recoveryRequired).toBe(true);
    expect(result.current.canAcknowledgeInputError).toBe(false);
    expect(result.current.canInput).toBe(false);
  });

  it("does not overlap polls and disables input when the last read gets stale", async () => {
    const { result, socket } = await start();
    await answer(socket, "surface.read_text", { text: "prompt" });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    const blocked = socket.take("workspace.list");
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(socket.requests.filter((request) => request.method === "workspace.list")).toHaveLength(
      0,
    );
    expect(result.current.canInput).toBe(false);
    await act(async () => {
      socket.reply(blocked, { workspaces });
    });
  });
});

describe("session target restoration", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const surfaceId = "22222222-2222-4222-8222-222222222222";
  const anotherSurfaceId = "33333333-3333-4333-8333-333333333333";
  const savedWorkspace = { id: workspaceId, ref: "workspace:8", title: "Saved", index: 1 };
  const savedSurface = {
    id: surfaceId,
    ref: "surface:8",
    title: "Saved terminal",
    type: "terminal",
  };
  const otherSurface = {
    ...savedSurface,
    id: anotherSurfaceId,
    ref: "surface:9",
    title: "Other terminal",
  };
  const storageKey = "cmux-remote.selection";

  it("stores only target UUIDs and restores them after checking live lists", async () => {
    const first = renderHook(() => useCmux());
    let socket = latestSocket();
    await act(async () => {
      socket.open();
    });
    await answer(socket, "workspace.list", { workspaces: [savedWorkspace] });
    await answer(socket, "surface.list", { surfaces: [savedSurface, otherSurface] });
    await answer(socket, "surface.read_text", { text: "private terminal content" });
    act(() => {
      first.result.current.selectSurface(anotherSurfaceId);
    });
    expect(savedSelection(storageKey)).toEqual({
      workspace: workspaceId,
      surface: anotherSurfaceId,
    });
    expect(window.sessionStorage.getItem(storageKey)).not.toContain("private");
    first.unmount();

    const restored = renderHook(() => useCmux());
    socket = latestSocket();
    expect(restored.result.current.canInput).toBe(false);
    expect(restored.result.current.content).toBe("");
    await act(async () => {
      socket.open();
    });
    await answer(socket, "workspace.list", { workspaces: [workspaces[0], savedWorkspace] });
    const surfaceList = await answer(socket, "surface.list", {
      surfaces: [savedSurface, otherSurface],
    });
    expect(surfaceList.params.workspace_ref).toBe(workspaceId);
    const read = await answer(socket, "surface.read_text", { text: "fresh restored output" });
    expect(read.params).toEqual({ workspace_ref: workspaceId, surface_ref: anotherSurfaceId });
    expect(restored.result.current.canInput).toBe(true);
  });

  it("requires explicit selection when a saved terminal has disappeared", async () => {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({ workspace: workspaceId, surface: surfaceId }),
    );
    const { result } = renderHook(() => useCmux());
    const socket = latestSocket();
    await act(async () => {
      socket.open();
    });
    await answer(socket, "workspace.list", { workspaces: [savedWorkspace] });
    await answer(socket, "surface.list", { surfaces: [otherSurface] });
    expect(result.current.currentSurface).toBe(null);
    expect(result.current.canInput).toBe(false);
    expect(socket.requests.some((request) => request.method === "surface.read_text")).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces: [savedWorkspace] });
    await answer(socket, "surface.list", { surfaces: [otherSurface] });
    expect(result.current.currentSurface).toBe(null);
  });

  it("does not replace a missing saved workspace with the Mac's selection", async () => {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({ workspace: workspaceId, surface: surfaceId }),
    );
    const { result } = renderHook(() => useCmux());
    const socket = latestSocket();
    await act(async () => {
      socket.open();
    });
    await answer(socket, "workspace.list", { workspaces });
    expect(result.current.currentWorkspace).toBe(null);
    expect(socket.requests.some((request) => request.method === "surface.list")).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await answer(socket, "workspace.list", { workspaces });
    expect(result.current.currentWorkspace).toBe(null);
    expect(savedSelection(storageKey)).toEqual({
      workspace: workspaceId,
      surface: surfaceId,
    });
  });
});
