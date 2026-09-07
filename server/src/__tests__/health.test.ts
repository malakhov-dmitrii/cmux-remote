import { describe, expect, it } from "bun:test";
import { createHealth } from "../health";

describe("health reflects usable cmux RPC", () => {
  it("reports unavailable when socket access is denied", async () => {
    const response = await createHealth(async () => {
      throw new Error("Access denied");
    }).request("/health");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "degraded", cmux: "unavailable" });
  });
  it("reports connected after a successful RPC", async () => {
    const response = await createHealth(async () => ({ workspaces: [] })).request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", cmux: "connected" });
  });
  it("refuses malformed successful RPC values", async () => {
    for (const value of [
      null,
      {},
      [],
      { error: "upstream failure" },
      { workspaces: [{ id: "alias", title: "bad" }] },
    ]) {
      const response = await createHealth(async () => value).request("/health");
      expect(response.status).toBe(503);
    }
  });
});
