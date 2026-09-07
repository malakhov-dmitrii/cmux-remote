import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { type AccessConfig, authorizeRequest } from "./access";
import { createHealth } from "./health";
import { InputState } from "./input-state";
import type { Executor } from "./rpc";
import { createWebSocketHandler, type WSData } from "./ws";
export function startBridge(
  config: AccessConfig,
  port: number,
  execute?: Executor,
  state = new InputState(),
) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    );
  });
  app.route("/", createHealth(execute));
  app.use("/*", serveStatic({ root: join(import.meta.dir, "../../client/dist") }));
  return Bun.serve<WSData>({
    hostname: "127.0.0.1",
    port,
    fetch(req, server) {
      if (!authorizeRequest(req, config))
        return new Response("Access denied", {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        });
      if (new URL(req.url).pathname === "/ws") {
        if (server.upgrade(req, { data: { active: true, inFlight: 0, seen: new Set() } })) return;
        return new Response("WebSocket upgrade required", { status: 400 });
      }
      return app.fetch(req);
    },
    websocket: createWebSocketHandler(execute, state),
  });
}
