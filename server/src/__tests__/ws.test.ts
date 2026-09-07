import { describe, expect, it } from "bun:test";
import { createRpcRequest, parseRpcResponse, type RpcResponse } from "../../../shared/protocol";
import { createWebSocketHandler, type WSConnection } from "../ws";

const socket = () => {
  const replies: RpcResponse[] = [];
  const peer: WSConnection = {
    data: { active: true, inFlight: 0, seen: new Set() },
    send(message) {
      replies.push(parseRpcResponse(message));
    },
  };
  return { peer, replies };
};
describe("websocket request guards", () => {
  it("blocks old cached clients and malformed requests before native RPC", async () => {
    let calls = 0;
    const handler = createWebSocketHandler(async () => {
      calls++;
      return {};
    });
    const { peer, replies } = socket();
    await handler.message(
      peer,
      JSON.stringify({ id: "old", method: "surface.send_text", params: { text: "never" } }),
    );
    await handler.message(peer, "{");
    await handler.message(peer, "x".repeat(24001));
    expect(replies).toMatchObject([
      { ok: false, error: { code: "unsupported_version", delivery: "not_sent" } },
      { ok: false, error: { code: "invalid_request" } },
      { ok: false, error: { code: "invalid_request" } },
    ]);
    expect(calls).toBe(0);
  });
  it("rejects duplicate IDs and over-capacity requests before dispatch", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const handler = createWebSocketHandler(async () => {
      calls++;
      await wait;
      return { workspaces: [] };
    });
    const { peer, replies } = socket();
    const first = JSON.stringify({ ...createRpcRequest("workspace.list"), id: "same" });
    const running = handler.message(peer, first);
    await handler.message(peer, first);
    const remaining = Array.from({ length: 7 }, (_, index) =>
      handler.message(
        peer,
        JSON.stringify({ ...createRpcRequest("workspace.list"), id: `other-${index}` }),
      ),
    );
    await handler.message(
      peer,
      JSON.stringify({ ...createRpcRequest("workspace.list"), id: "excess" }),
    );
    expect(calls).toBe(8);
    expect(replies).toMatchObject([
      { id: "same", ok: false, error: { code: "busy" } },
      { id: "excess", ok: false, error: { code: "busy" } },
    ]);
    release();
    await Promise.all([running, ...remaining]);
    expect(peer.data.inFlight).toBe(0);
    expect(replies.filter((reply) => reply.ok)).toHaveLength(8);
  });
  it("does not reply or dispatch again after close", async () => {
    const { peer, replies } = socket();
    let calls = 0;
    const handler = createWebSocketHandler(async () => {
      calls++;
      return { workspaces: [] };
    });
    handler.close(peer);
    await handler.message(peer, JSON.stringify(createRpcRequest("workspace.list")));
    expect(calls).toBe(0);
    expect(replies).toEqual([]);
  });
});
