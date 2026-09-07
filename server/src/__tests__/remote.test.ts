import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRpcRequest, type RpcMethod } from "../../../shared/protocol";
import { type AccessConfig, authorizeRequest } from "../access";
import { InputState } from "../input-state";
import { type Executor, handleRpc } from "../rpc";

const workspace = "11111111-1111-1111-1111-111111111111";
const surface = "22222222-2222-2222-2222-222222222222";
const target = { workspace_ref: workspace, surface_ref: surface };
const listing = {
  surfaces: [{ id: surface, ref: "surface:1", title: "Test terminal", type: "terminal" }],
};
const access: AccessConfig = {
  localOrigin: "http://127.0.0.1:3456",
  remoteOrigin: "https://test.tailnet.ts.net:8443",
  allowedLogin: "owner@example.test",
};
describe("private browser access", () => {
  it("requires the owner identity and exact websocket origin", () => {
    for (const login of [undefined, "stranger@example.test"]) {
      const headers: Record<string, string> = { Origin: access.remoteOrigin };
      if (login) headers["Tailscale-User-Login"] = login;
      expect(authorizeRequest(new Request(`${access.remoteOrigin}/ws`, { headers }), access)).toBe(
        false,
      );
    }
    for (const origin of [undefined, "null", "https://evil.test"]) {
      const headers: Record<string, string> = { "Tailscale-User-Login": access.allowedLogin };
      if (origin) headers.Origin = origin;
      expect(authorizeRequest(new Request(`${access.remoteOrigin}/ws`, { headers }), access)).toBe(
        false,
      );
    }
    expect(
      authorizeRequest(
        new Request(`${access.remoteOrigin}/ws`, {
          headers: { Origin: access.remoteOrigin, "Tailscale-User-Login": access.allowedLogin },
        }),
        access,
      ),
    ).toBe(true);
  });
  it("blocks rebinding and every proxied-local marker", () => {
    expect(
      authorizeRequest(
        new Request("http://evil.test:3456/ws", { headers: { Origin: "http://evil.test:3456" } }),
        access,
      ),
    ).toBe(false);
    expect(
      authorizeRequest(
        new Request(`${access.localOrigin}/ws`, { headers: { Origin: access.localOrigin } }),
        access,
      ),
    ).toBe(true);
    for (const marker of [
      "X-Forwarded-For",
      "X-Forwarded-Proto",
      "X-Forwarded-Host",
      "Forwarded",
      "Tailscale-User-Login",
      "Tailscale-Headers-Info",
      "Tailscale-Funnel-Request",
    ]) {
      expect(
        authorizeRequest(
          new Request(`${access.localOrigin}/ws`, {
            headers: { Origin: access.localOrigin, [marker]: "spoofed" },
          }),
          access,
        ),
      ).toBe(false);
    }
  });
});
describe("input routing and durable recovery", () => {
  let directory: string;
  let state: InputState;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "cmux-remote-state-test-"));
    state = new InputState(directory);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const request = (method: RpcMethod, params: Record<string, unknown> = {}) =>
    createRpcRequest(method, { ...target, ...params });
  it("sends literal text to explicit UUIDs and clears acknowledged markers", async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const text = "echo '$(literal)' café";
    const execute: Executor = async (method, params) => {
      calls.push({ method, params });
      return method === "surface.list" ? listing : {};
    };
    expect((await handleRpc(request("surface.send_text", { text }), execute, state)).ok).toBe(true);
    expect(calls).toEqual([
      { method: "surface.list", params: { workspace_id: workspace } },
      {
        method: "surface.send_text",
        params: { workspace_id: workspace, surface_id: surface, text },
      },
    ]);
    expect(await state.pending(workspace, surface)).toBe(false);
  });
  it("locks the whole submit and rejects another browser without queueing it", async () => {
    let release!: () => void;
    let reached!: () => void;
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const execute: Executor = async (method) => {
      calls.push(method);
      if (method === "surface.list") return listing;
      if (method === "surface.send_text") {
        reached();
        await barrier;
      }
      return {};
    };
    const first = handleRpc(request("surface.submit", { text: "echo A" }), execute, state);
    await entered;
    const competing = await handleRpc(
      request("surface.submit", { text: "echo B" }),
      execute,
      state,
    );
    expect(competing).toMatchObject({ ok: false, error: { code: "busy", delivery: "not_sent" } });
    release();
    expect((await first).ok).toBe(true);
    expect(calls).toEqual(["surface.list", "surface.send_text", "surface.send_key"]);
  });
  it("preserves partial-submit state across clients and restart until confirmed Ctrl+C", async () => {
    const writes: string[] = [];
    const failing: Executor = async (method, params) => {
      if (method === "surface.list") return listing;
      writes.push(String(params.key ?? params.text));
      if (params.key === "enter") throw new Error("lost acknowledgement");
      return {};
    };
    expect(
      await handleRpc(request("surface.submit", { text: "echo A" }), failing, state),
    ).toMatchObject({ ok: false, error: { delivery: "text_inserted" } });
    const restarted = new InputState(directory);
    expect(await restarted.pending(workspace, surface)).toBe(true);
    for (const next of [
      request("surface.submit", { text: "echo B" }),
      request("surface.send_key", { key: "enter" }),
      request("surface.send_key", { key: "ctrl+c" }),
    ]) {
      expect(await handleRpc(next, failing, restarted)).toMatchObject({
        ok: false,
        error: { code: "recovery_required" },
      });
    }
    expect(writes).toEqual(["echo A", "enter"]);
    const working: Executor = async (method, params) => {
      if (method === "surface.list") return listing;
      writes.push(String(params.key ?? params.text));
      return {};
    };
    expect(
      (
        await handleRpc(
          request("surface.send_key", { key: "ctrl+c", confirmRecovery: true }),
          working,
          restarted,
        )
      ).ok,
    ).toBe(true);
    expect(
      (await handleRpc(request("surface.submit", { text: "echo B" }), working, restarted)).ok,
    ).toBe(true);
    expect(writes).toEqual(["echo A", "enter", "ctrl+c", "echo B", "enter"]);
  });
  it("never sends Enter after failed text or a disconnected text acknowledgement", async () => {
    for (const disconnect of [false, true]) {
      let active = true;
      const calls: string[] = [];
      const execute: Executor = async (method) => {
        calls.push(method);
        if (method === "surface.list") return listing;
        if (disconnect) {
          active = false;
          return {};
        }
        throw new Error("text delivery uncertain");
      };
      const result = await handleRpc(
        request("surface.submit", { text: "test" }),
        execute,
        state,
        () => active,
      );
      expect(result).toMatchObject({
        ok: false,
        error: { delivery: disconnect ? "text_inserted" : "unknown" },
      });
      expect(calls).toEqual(["surface.list", "surface.send_text"]);
      expect(await state.pending(workspace, surface)).toBe(true);
      await state.acknowledge(workspace, surface);
    }
  });
  it("keeps the marker when explicit recovery itself fails", async () => {
    await state.begin(workspace, surface);
    const result = await handleRpc(
      request("surface.send_key", { key: "ctrl+c", confirmRecovery: true }),
      async (method) => {
        if (method === "surface.list") return listing;
        throw new Error("Ctrl+C acknowledgement lost");
      },
      state,
    );
    expect(result).toMatchObject({ ok: false, error: { delivery: "unknown" } });
    expect(await new InputState(directory).pending(workspace, surface)).toBe(true);
  });
  it("does not send input after disconnection during target validation", async () => {
    let active = true;
    const calls: string[] = [];
    const result = await handleRpc(
      request("surface.submit", { text: "never sent" }),
      async (method) => {
        calls.push(method);
        active = false;
        return listing;
      },
      state,
      () => active,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "connection_closed", delivery: "not_sent" },
    });
    expect(calls).toEqual(["surface.list"]);
    expect(await state.pending(workspace, surface)).toBe(false);
  });
  it("writes private empty markers before native input and fails closed on unsafe storage", async () => {
    const execute: Executor = async (method) => {
      if (method === "surface.list") return listing;
      const files = await readdir(directory);
      expect(files).toEqual([`${workspace}.${surface}.pending`]);
      expect(await readFile(join(directory, files[0] ?? ""), "utf8")).toBe("");
      expect((await lstat(join(directory, files[0] ?? ""))).mode & 0o777).toBe(0o600);
      throw new Error("unconfirmed");
    };
    await handleRpc(request("surface.send_text", { text: "private text" }), execute, state);
    await chmod(directory, 0o755);
    let calls = 0;
    expect(
      await handleRpc(
        request("surface.send_text", { text: "never sent" }),
        async () => {
          calls++;
          return listing;
        },
        state,
      ),
    ).toMatchObject({ ok: false, error: { code: "storage_error", delivery: "not_sent" } });
    expect(calls).toBe(0);
  });
  it("refuses absent or browser surfaces and bounds reads", async () => {
    for (const surfaces of [[], [{ ...listing.surfaces[0], type: "browser" }]]) {
      const calls: string[] = [];
      const result = await handleRpc(
        request("surface.send_key", { key: "enter" }),
        async (method) => {
          calls.push(method);
          return { surfaces };
        },
        state,
      );
      expect(result.ok).toBe(false);
      expect(calls).toEqual(["surface.list"]);
    }
    const read = await handleRpc(
      request("surface.read_text"),
      async (method, params) => {
        expect(method).toBe("surface.read_text");
        expect(params).toEqual({ workspace_id: workspace, surface_id: surface, lines: 200 });
        return { text: "snapshot" };
      },
      state,
    );
    expect(read).toMatchObject({ ok: true, result: { text: "snapshot" } });
  });
});
