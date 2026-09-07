import { afterEach, describe, expect, it } from "bun:test";
import { createRpcRequest, isRecord } from "../../../shared/protocol";
import { startBridge } from "../index";
import type { Executor } from "../rpc";

const servers: ReturnType<typeof startBridge>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});
function start(execute: Executor) {
  const config = {
    localOrigin: "http://127.0.0.1:0",
    remoteOrigin: "https://remote.test:8443",
    allowedLogin: "owner@example.test",
  };
  const server = startBridge(config, 0, execute);
  config.localOrigin = `http://127.0.0.1:${server.port}`;
  servers.push(server);
  return config;
}
describe("HTTP and WebSocket access boundary", () => {
  it("blocks foreign Host and reports real upstream failures", async () => {
    const config = start(async () => {
      throw new Error("access denied");
    });
    const denied = await fetch(`${config.localOrigin}/health`, { headers: { Host: "evil.test" } });
    expect(denied.status).toBe(403);
    const degraded = await fetch(`${config.localOrigin}/health`);
    expect(degraded.status).toBe(503);
    expect(degraded.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects cross-origin websocket upgrades before any upstream call", async () => {
    let calls = 0;
    const config = start(async () => {
      calls++;
      return {};
    });
    const response = await fetch(`${config.localOrigin}/ws`, {
      headers: {
        Origin: "https://evil.test",
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    expect(response.status).toBe(403);
    expect(calls).toBe(0);
  });
  it("returns scoped RPC data over a same-origin websocket", async () => {
    const config = start(async (method) => {
      expect(method).toBe("workspace.list");
      return {
        workspaces: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            ref: "workspace:1",
            title: "Disposable",
            index: 0,
          },
        ],
      };
    });
    const message = await new Promise<unknown>((resolve, reject) => {
      const ws = new WebSocket(`${config.localOrigin.replace("http:", "ws:")}/ws`, {
        headers: { Origin: config.localOrigin },
      });
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("No WS reply"));
      }, 2000);
      ws.onopen = () => ws.send(JSON.stringify({ ...createRpcRequest("workspace.list"), id: "1" }));
      ws.onmessage = (event) => {
        clearTimeout(timeout);
        ws.close();
        resolve(JSON.parse(String(event.data)));
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WS failed"));
      };
    });
    expect(isRecord(message) && message.ok).toBe(true);
    expect(message).toEqual({
      id: "1",
      ok: true,
      result: {
        workspaces: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            ref: "workspace:1",
            title: "Disposable",
            index: 0,
            selected: false,
          },
        ],
      },
    });
  });
});
