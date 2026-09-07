import { describe, expect, it } from "bun:test";
import { createRpcRequest, normalizeWorkspaceOptions, parseCreatedTarget } from "./protocol";

const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const surface = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
describe("creation protocol", () => {
  it("accepts bounded optional workspace fields and drops native overrides", () => {
    expect(
      createRpcRequest("workspace.create", {
        name: " Atlas ",
        cwd: " ~/code ",
        command: "bad",
        focus: true,
      }).params,
    ).toEqual({ name: "Atlas", cwd: "~/code" });
    expect(normalizeWorkspaceOptions({ name: " ", cwd: "" })).toEqual({});
    expect(
      normalizeWorkspaceOptions({ name: "a".repeat(80), cwd: `/${"a".repeat(4095)}` }),
    ).toHaveProperty("name");
    for (const params of [
      { name: 3 },
      { cwd: false },
      { name: "a".repeat(81) },
      { cwd: "a".repeat(4097) },
      { name: "bad\nname" },
      { cwd: "bad\0path" },
    ]) {
      expect(() => normalizeWorkspaceOptions(params)).toThrow();
    }
  });
  it("requires explicit stable IDs for new tabs and excludes unsafe fields", () => {
    expect(
      createRpcRequest("surface.create", {
        workspace_ref: workspace,
        surface_ref: surface,
        pane_id: workspace,
        type: "browser",
        url: "https://example.test",
      }).params,
    ).toEqual({ workspace_ref: workspace, surface_ref: surface });
    for (const params of [
      {},
      { workspace_ref: workspace },
      { workspace_ref: workspace, surface_ref: "surface:1" },
    ]) {
      expect(() => createRpcRequest("surface.create", params)).toThrow();
    }
  });
  it("treats malformed creation acknowledgements as uncertain", () => {
    expect(parseCreatedTarget({ workspace_id: workspace, surface_id: surface })).toEqual({
      workspace_id: workspace,
      surface_id: surface,
    });
    for (const value of [
      null,
      {},
      { workspace_id: workspace, surface_id: null },
      { workspace_id: "workspace:1", surface_id: surface },
    ]) {
      try {
        parseCreatedTarget(value);
        throw new Error("Accepted invalid target");
      } catch (error) {
        expect(error).toMatchObject({ code: "invalid_response", delivery: "unknown" });
      }
    }
  });
});
