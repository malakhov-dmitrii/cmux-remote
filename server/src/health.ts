import { Hono } from "hono";
import { parseWorkspaces } from "../../shared/protocol";
import { executeCmux } from "./cmux-cli";
import type { Executor } from "./rpc";
export function createHealth(execute: Executor = executeCmux) {
  const health = new Hono();
  health.get("/health", async (c) => {
    try {
      parseWorkspaces(await execute("workspace.list", {}));
      return c.json({ status: "ok", cmux: "connected" });
    } catch {
      return c.json({ status: "degraded", cmux: "unavailable" }, 503);
    }
  });
  return health;
}
